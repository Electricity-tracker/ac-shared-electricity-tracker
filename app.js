const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_API_KEY
);

// Telegram Notification Service
async function sendTelegramMessage(message) {
  try {
    await fetch(
      "/.netlify/functions/sendTelegram",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
        }),
      }
    );
  } catch (err) {
    console.error(err);
  }
}

// Load active users onto the UI
async function loadActiveUsers() {
  const { data } = await supabaseClient
    .from("active_users")
    .select("*");

  const container = document.getElementById("activeUsers");
  container.innerHTML = "";

  if (data) {
    data.forEach((user) => {
      container.innerHTML += `
        <span class="user-badge">
          ${user.user_name}
        </span>
      `;
    });
  }
}

// Load financial and unit summary onto the UI
async function loadSummary() {
  const { data } = await supabaseClient
    .from("user_totals")
    .select("*");

  const container = document.getElementById("summary");
  container.innerHTML = "";

  if (data) {
    data.forEach((user) => {
      container.innerHTML += `
        <div class="summary-item">
          <strong>${user.user_name}</strong>
          <br>
          Units: ${Number(user.total_units).toFixed(2)}
          <br>
          Amount: ₹${Number(user.total_amount).toFixed(2)}
        </div>
      `;
    });
  }
}

// Recalculate billing engine (Handles out-of-order/late emergency exits)
async function recalculateAllBilling() {
  // 1. Wipe old calculation caches entirely to build fresh
  await supabaseClient
    .from("usage_segments")
    .delete()
    .not("id", "is", null);

  await supabaseClient
    .from("user_totals")
    .delete()
    .not("user_name", "is", null);

  // CRITICAL FIX: Always pull events sorted by the actual meter value, NOT the insertion time.
  // This places a late '12' perfectly before a previously entered '13'.
  const { data: events } = await supabaseClient
    .from("events")
    .select("*")
    .order("meter_reading", { ascending: true });

  if (!events || events.length === 0) {
    return;
  }

  let activeUsers = [];

  for (let i = 0; i < events.length - 1; i++) {
    const currentEvent = events[i];
    const nextEvent = events[i + 1];

    // FIX: Update active users state *before* analyzing the consumption window ahead
    if (currentEvent.action === "JOIN") {
      if (!activeUsers.includes(currentEvent.user_name)) {
        activeUsers.push(currentEvent.user_name);
      }
    } else if (currentEvent.action === "EXIT") {
      activeUsers = activeUsers.filter(u => u !== currentEvent.user_name);
    }

    const startMeter = Number(currentEvent.meter_reading);
    const endMeter = Number(nextEvent.meter_reading);

    // CRITICAL: Validate that meter readings are never negative
    if (startMeter < 0 || endMeter < 0) {
      console.warn(`Invalid meter readings detected: start=${startMeter}, end=${endMeter}. Skipping calculation.`);
      continue;
    }

    // If an active session exists and numbers are climbing, run calculation
    if (activeUsers.length > 0 && endMeter > startMeter) {
      const unitsUsed = Number((endMeter - startMeter).toFixed(2));
      const cost = Number((unitsUsed * UNIT_PRICE).toFixed(2));
      const splitPerUser = Number((cost / activeUsers.length).toFixed(2));

      await supabaseClient
        .from("usage_segments")
        .insert({
          start_meter: startMeter,
          end_meter: endMeter,
          units_used: unitsUsed,
          active_users: [...activeUsers],
          cost,
          split_per_user: splitPerUser,
        });

      // Update compiled summary metrics
      for (const user of activeUsers) {
        const { data: existing } = await supabaseClient
          .from("user_totals")
          .select("*")
          .eq("user_name", user)
          .maybeSingle();

        if (existing) {
          await supabaseClient
            .from("user_totals")
            .update({
              total_amount: Number(existing.total_amount) + splitPerUser,
              total_units: Number(existing.total_units) + (unitsUsed / activeUsers.length),
            })
            .eq("user_name", user);
        } else {
          await supabaseClient
            .from("user_totals")
            .insert({
              user_name: user,
              total_amount: splitPerUser,
              total_units: (unitsUsed / activeUsers.length),
            });
        }
      }
    }
  }

  await loadSummary();
}

// Handle primary actions (JOIN / EXIT standard buttons)
async function handleAction(action) {
  const userName = document.getElementById("userSelect").value;
  const meterReadingInput = document.getElementById("meterReading").value;
  const meterReading = Number(meterReadingInput);

  // Form Validations
  if (meterReadingInput === "" || meterReadingInput === null || isNaN(meterReading)) {
    alert("Enter meter reading");
    return;
  }

  // CRITICAL: Reject any negative or invalid meter readings
  if (meterReading < 0 || !Number.isFinite(meterReading)) {
    alert("Meter reading cannot be negative. Please enter a valid positive number.");
    return;
  }

  // FIX FOR LATE EXIT EMERGENCIES: 
  // We only block backward values on a *JOIN*. We bypass this validation on *EXIT* 
  // so users can insert a skipped past exit value (like entering 12 even if 13 is already in DB).
  if (action === "JOIN") {
    const { data: lastEvent } = await supabaseClient
      .from("events")
      .select("*")
      .order("meter_reading", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastEvent && meterReading < Number(lastEvent.meter_reading)) {
      alert("New JOIN meter reading cannot be lower than the latest recorded system meter");
      return;
    }
  }

  // Pull online roster status
  const { data: activeUsersData } = await supabaseClient
    .from("active_users")
    .select("*");

  const activeUsers = activeUsersData ? activeUsersData.map((u) => u.user_name) : [];

  // Rules enforcement
  if (action === "JOIN" && activeUsers.includes(userName)) {
    alert("User already active");
    return;
  }

  if (action === "EXIT" && !activeUsers.includes(userName)) {
    alert("User not active");
    return;
  }

  // Verify baseline 0 point
  const { data: allEvents } = await supabaseClient
    .from("events")
    .select("*");

  const isFirstUsage = !allEvents || allEvents.length === 0;

  if (isFirstUsage && meterReading !== 0) {
    alert("First meter reading must be 0");
    return;
  }

  // Push event timeline marker
  await supabaseClient
    .from("events")
    .insert({
      user_name: userName,
      action,
      meter_reading: meterReading,
    });

  // Track live user panel registry status
  if (action === "JOIN") {
    await supabaseClient
      .from("active_users")
      .insert({ user_name: userName });
  } else {
    await supabaseClient
      .from("active_users")
      .delete()
      .eq("user_name", userName);
  }

  // Trigger mathematical history rebuild
  await recalculateAllBilling();

  // Telegram dispatch message
  await sendTelegramMessage(
`❄️ AC UPDATE

👤 User:
${userName}

🚪 Action:
${action}

📟 Meter:
${meterReading}`
  );

  // Clean form input field
  document.getElementById("meterReading").value = "";

  // Refresh user screens
  await loadActiveUsers();
  await loadSummary();
}

// Retained clean correction utility function for completely overriding wrong record indices
async function updateMissedExit() {
  const userName = document.getElementById("userSelect").value;
  const correctMeterInput = document.getElementById("meterReading").value;
  const correctMeter = Number(correctMeterInput);

  // CRITICAL: Strictly validate - no negative values allowed
  if (correctMeterInput === "" || isNaN(correctMeter) || correctMeter < 0 || !Number.isFinite(correctMeter)) {
    alert("Meter reading must be a valid positive number (no negative values allowed)");
    return;
  }

  const { data: latestExit } = await supabaseClient
    .from("events")
    .select("*")
    .eq("user_name", userName)
    .eq("action", "EXIT")
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestExit) {
    alert("No EXIT record found");
    return;
  }

  const { data: latestSystemEvent } = await supabaseClient
    .from("events")
    .select("*")
    .order("meter_reading", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestSystemEvent && correctMeter > Number(latestSystemEvent.meter_reading)) {
    alert("Correction meter cannot exceed latest system meter");
    return;
  }

  await supabaseClient
    .from("events")
    .update({ meter_reading: correctMeter })
    .eq("id", latestExit.id);

  await recalculateAllBilling();

  await sendTelegramMessage(
`✏️ EXIT UPDATED

👤 User:
${userName}

📟 Correct Exit Meter:
${correctMeter}`
  );

  alert("Exit updated successfully");
  document.getElementById("meterReading").value = "";
  await loadSummary();
}

// Bind active interface handlers
const joinBtn = document.getElementById("joinBtn");
if (joinBtn) {
  joinBtn.addEventListener("click", () => handleAction("JOIN"));
}

const exitBtn = document.getElementById("exitBtn");
if (exitBtn) {
  exitBtn.addEventListener("click", () => handleAction("EXIT"));
}

const updateExitBtn = document.getElementById("updateExitBtn");
if (updateExitBtn) {
  updateExitBtn.addEventListener("click", updateMissedExit);
}

// Initialization execute loop run
loadActiveUsers();
loadSummary();