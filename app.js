const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_API_KEY
);

// Electricity unit price
const UNIT_PRICE = 8;

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

// Get current date and time
function getCurrentDateTime() {

  const now = new Date();

  const day = String(now.getDate()).padStart(2, "0");

  const month = now
    .toLocaleDateString("en-US", {
      month: "short",
    })
    .toLowerCase();

  const year = now.getFullYear();

  const hours = String(now.getHours()).padStart(2, "0");

  const minutes = String(now.getMinutes()).padStart(2, "0");

  const seconds = String(now.getSeconds()).padStart(2, "0");

  const ampm =
    now.getHours() >= 12
      ? "PM"
      : "AM";

  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds} ${ampm}`;
}

// Generate completed cycle summary message
async function generateCycleSummaryMessage() {

  const { data: userTotals } =
    await supabaseClient
      .from("user_totals")
      .select("*");

  if (
    !userTotals ||
    userTotals.length === 0
  ) {
    return null;
  }

  let message =
    `🔄 CYCLE COMPLETED\n\n`;

  message +=
    `📅 Date & Time:\n${getCurrentDateTime()}\n\n`;

  message +=
    `📊 Individual Usage & Bills:\n\n`;

  let totalUnits = 0;

  let totalAmount = 0;

  for (const user of userTotals) {

    const units =
      Number(user.total_units);

    const amount =
      Number(user.total_amount);

    totalUnits += units;

    totalAmount += amount;

    message +=
`👤 ${user.user_name}
   Units: ${units.toFixed(2)}
   Amount: ₹${amount.toFixed(2)}

`;

  }

  message +=
`━━━━━━━━━━━━━━━━━
📈 Cycle Totals:
   Total Units: ${totalUnits.toFixed(2)}
   Total Amount: ₹${totalAmount.toFixed(2)}
`;

  return message;
}

// Reset cycle data
async function resetCycleData() {

  console.log(
    "🔄 Resetting database for new cycle..."
  );

  // Get last reading
  const { data: lastEventData } =
    await supabaseClient
      .from("events")
      .select("*")
      .order("meter_reading", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

  const lastMeterReading =
    lastEventData
      ? Number(
          lastEventData.meter_reading
        )
      : 0;

  // Save cycle history
  const { data: totals } =
    await supabaseClient
      .from("user_totals")
      .select("*");

  let totalUnits = 0;

  let totalAmount = 0;

  if (totals) {

    totals.forEach((u) => {

      totalUnits += Number(
        u.total_units
      );

      totalAmount += Number(
        u.total_amount
      );

    });

  }

  await supabaseClient
    .from("cycle_history")
    .insert({

      cycle_end_reading:
        lastMeterReading,

      total_units:
        Number(
          totalUnits.toFixed(2)
        ),

      total_amount:
        Number(
          totalAmount.toFixed(2)
        ),

      completed_at:
        new Date().toISOString(),

    });

  // Clear tables
  await supabaseClient
    .from("user_totals")
    .delete()
    .not(
      "user_name",
      "is",
      null
    );

  await supabaseClient
    .from("usage_segments")
    .delete()
    .not(
      "id",
      "is",
      null
    );

  await supabaseClient
    .from("events")
    .delete()
    .not(
      "id",
      "is",
      null
    );

  await supabaseClient
    .from("active_users")
    .delete()
    .not(
      "user_name",
      "is",
      null
    );

  // Create baseline
  if (
    lastMeterReading > 0
  ) {

    await supabaseClient
      .from("events")
      .insert({

        user_name:
          "SYSTEM",

        action:
          "BASELINE",

        meter_reading:
          lastMeterReading,

      });

    console.log(
      `✅ New cycle baseline created at meter ${lastMeterReading}`
    );

  }
}

// Load active users
async function loadActiveUsers() {

  const { data } =
    await supabaseClient
      .from("active_users")
      .select("*");

  const container =
    document.getElementById(
      "activeUsers"
    );

  if (!container) return;

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

// Load last reading
async function loadLastMeterReading() {

  const { data: lastEvent } =
    await supabaseClient
      .from("events")
      .select("*")
      .order("meter_reading", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

  const container =
    document.getElementById(
      "lastReading"
    );

  if (!container) return;

  if (lastEvent) {

    container.innerHTML = `
      <div class="last-reading-item">

        <strong>
          Last Recorded Reading:
        </strong>

        <span class="meter-value">
          ${Number(
            lastEvent.meter_reading
          ).toFixed(2)} units
        </span>

      </div>
    `;

  } else {

    container.innerHTML = `
      <div class="last-reading-item">
        No readings yet
      </div>
    `;

  }
}

// Load current cycle summary
async function loadSummary() {

  const { data } =
    await supabaseClient
      .from("user_totals")
      .select("*");

  const container =
    document.getElementById(
      "summary"
    );

  if (!container) return;

  container.innerHTML = "";

  if (
    data &&
    data.length > 0
  ) {

    data.forEach((user) => {

      container.innerHTML += `
        <div class="summary-item">

          <strong>
            ${user.user_name}
          </strong>

          <br>

          Units:
          ${Number(
            user.total_units
          ).toFixed(2)}

          <br>

          Amount:
          ₹${Number(
            user.total_amount
          ).toFixed(2)}

        </div>
      `;

    });

  } else {

    container.innerHTML = `
      <div class="summary-item">
        No active cycle summary yet
      </div>
    `;

  }
}

// Load last completed cycle
async function loadLastCycleSummary() {

  const { data } =
    await supabaseClient
      .from("cycle_history")
      .select("*")
      .order("completed_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

  const container =
    document.getElementById(
      "lastCycleSummary"
    );

  if (!container) return;

  if (data) {

    container.innerHTML = `
      <div class="summary-item">

        <strong>
          Last Completed Cycle
        </strong>

        <br>

        End Meter:
        ${Number(
          data.cycle_end_reading
        ).toFixed(2)}

        <br>

        Total Units:
        ${Number(
          data.total_units
        ).toFixed(2)}

        <br>

        Total Amount:
        ₹${Number(
          data.total_amount
        ).toFixed(2)}

        <br>

        Completed At:
        ${new Date(
          data.completed_at
        ).toLocaleString()}

      </div>
    `;

  } else {

    container.innerHTML = `
      <div class="summary-item">
        No completed cycles yet
      </div>
    `;

  }
}

// Recalculate billing
async function recalculateAllBilling() {

  // Clear old calculations
  await supabaseClient
    .from("usage_segments")
    .delete()
    .not(
      "id",
      "is",
      null
    );

  await supabaseClient
    .from("user_totals")
    .delete()
    .not(
      "user_name",
      "is",
      null
    );

  // Load events
  const { data: allEventsRaw } =
    await supabaseClient
      .from("events")
      .select("*")
      .order("meter_reading", {
        ascending: true,
      })
      .order("created_at", {
        ascending: true,
      });

  if (
    !allEventsRaw ||
    allEventsRaw.length === 0
  ) {
    return;
  }

  // Remove baseline
  const events =
    allEventsRaw.filter(
      (e) =>
        e.action !== "BASELINE"
    );

  if (
    events.length === 0
  ) {
    return;
  }

  let activeUsers = [];

  for (
    let i = 0;
    i < events.length - 1;
    i++
  ) {

    const currentEvent =
      events[i];

    const nextEvent =
      events[i + 1];

    // Apply state
    if (
      currentEvent.action ===
      "JOIN"
    ) {

      if (
        !activeUsers.includes(
          currentEvent.user_name
        )
      ) {

        activeUsers.push(
          currentEvent.user_name
        );

      }
    }

    if (
      currentEvent.action ===
      "EXIT"
    ) {

      activeUsers =
        activeUsers.filter(
          (u) =>
            u !==
            currentEvent.user_name
        );

    }

    const startMeter =
      Number(
        currentEvent.meter_reading
      );

    const endMeter =
      Number(
        nextEvent.meter_reading
      );

    if (
      !Number.isFinite(
        startMeter
      ) ||
      !Number.isFinite(
        endMeter
      )
    ) {
      continue;
    }

    if (
      startMeter < 0 ||
      endMeter < 0
    ) {
      continue;
    }

    if (
      endMeter <= startMeter
    ) {
      continue;
    }

    if (
      activeUsers.length === 0
    ) {
      continue;
    }

    const unitsUsed =
      Number(
        (
          endMeter -
          startMeter
        ).toFixed(2)
      );

    const cost =
      Number(
        (
          unitsUsed *
          UNIT_PRICE
        ).toFixed(2)
      );

    const splitUnits =
      Number(
        (
          unitsUsed /
          activeUsers.length
        ).toFixed(4)
      );

    const splitCost =
      Number(
        (
          cost /
          activeUsers.length
        ).toFixed(2)
      );

    // Save segment
    await supabaseClient
      .from("usage_segments")
      .insert({

        start_meter:
          startMeter,

        end_meter:
          endMeter,

        units_used:
          unitsUsed,

        active_users:
          [...activeUsers],

        cost,

        split_per_user:
          splitCost,

      });

    // Update totals
    for (const user of activeUsers) {

      const { data: existing } =
        await supabaseClient
          .from("user_totals")
          .select("*")
          .eq(
            "user_name",
            user
          )
          .maybeSingle();

      if (existing) {

        const updatedAmount =
          Number(
            (
              Number(
                existing.total_amount
              ) +
              splitCost
            ).toFixed(2)
          );

        const updatedUnits =
          Number(
            (
              Number(
                existing.total_units
              ) +
              splitUnits
            ).toFixed(4)
          );

        await supabaseClient
          .from("user_totals")
          .update({

            total_amount:
              updatedAmount,

            total_units:
              updatedUnits,

          })
          .eq(
            "user_name",
            user
          );

      } else {

        await supabaseClient
          .from("user_totals")
          .insert({

            user_name:
              user,

            total_amount:
              splitCost,

            total_units:
              splitUnits,

          });

      }
    }
  }

  await loadSummary();
}

// Main action handler
async function handleAction(action) {

  const userName =
    document.getElementById(
      "userSelect"
    ).value;

  const meterReadingInput =
    document.getElementById(
      "meterReading"
    ).value;

  const meterReading =
    Number(
      meterReadingInput
    );

  // Validation
  if (
    meterReadingInput === "" ||
    isNaN(meterReading)
  ) {

    alert(
      "Enter valid meter reading"
    );

    return;
  }

  // Prevent negative
  if (
    meterReading < 0 ||
    !Number.isFinite(
      meterReading
    )
  ) {

    alert(
      "Meter reading must be positive"
    );

    return;
  }

  // Get all events
  const { data: allEvents } =
    await supabaseClient
      .from("events")
      .select("*");

  // First usage validation
  const isFreshSystem =
    !allEvents ||
    allEvents.length === 0;

  if (
    isFreshSystem &&
    meterReading !== 0
  ) {

    alert(
      "First meter reading must be 0"
    );

    return;
  }

  // Baseline validation
  const baselineEvent =
    allEvents
      ? allEvents.find(
          (e) =>
            e.action ===
            "BASELINE"
        )
      : null;

  if (
    baselineEvent &&
    action === "JOIN"
  ) {

    const baselineReading =
      Number(
        baselineEvent.meter_reading
      );

    if (
      meterReading <
      baselineReading
    ) {

      alert(
        `New cycle must start from at least ${baselineReading}`
      );

      return;
    }
  }

  // Prevent backward JOIN
  if (
    action === "JOIN"
  ) {

    const { data: latestEvent } =
      await supabaseClient
        .from("events")
        .select("*")
        .order(
          "meter_reading",
          {
            ascending: false,
          }
        )
        .limit(1)
        .maybeSingle();

    if (
      latestEvent &&
      meterReading <
        Number(
          latestEvent.meter_reading
        )
    ) {

      alert(
        "JOIN reading cannot be lower than latest meter"
      );

      return;
    }
  }

  // Active users
  const { data: activeUsersData } =
    await supabaseClient
      .from("active_users")
      .select("*");

  const activeUsers =
    activeUsersData
      ? activeUsersData.map(
          (u) =>
            u.user_name
        )
      : [];

  // Duplicate JOIN
  if (
    action === "JOIN" &&
    activeUsers.includes(
      userName
    )
  ) {

    alert(
      "User already active"
    );

    return;
  }

  // EXIT validation
  if (
    action === "EXIT" &&
    !activeUsers.includes(
      userName
    )
  ) {

    alert(
      "User not active"
    );

    return;
  }

  // Insert event
  await supabaseClient
    .from("events")
    .insert({

      user_name:
        userName,

      action,

      meter_reading:
        meterReading,

    });

  // Update active users
  if (
    action === "JOIN"
  ) {

    await supabaseClient
      .from("active_users")
      .insert({
        user_name:
          userName,
      });

  }

  if (
    action === "EXIT"
  ) {

    await supabaseClient
      .from("active_users")
      .delete()
      .eq(
        "user_name",
        userName
      );

  }

  // Recalculate
  await recalculateAllBilling();

  // Check completion
  const { data: remainingUsers } =
    await supabaseClient
      .from("active_users")
      .select("*");

  if (
    action === "EXIT" &&
    remainingUsers &&
    remainingUsers.length === 0
  ) {

    const cycleSummary =
      await generateCycleSummaryMessage();

    if (cycleSummary) {

      await sendTelegramMessage(
        cycleSummary
      );

    }

    await resetCycleData();
  }

  // Telegram update
  await sendTelegramMessage(
`❄️ AC UPDATE

👤 User:
${userName}

🚪 Action:
${action}

📟 Meter:
${meterReading}`
  );

  // Clear input
  document.getElementById(
    "meterReading"
  ).value = "";

  // Refresh UI
  await loadActiveUsers();

  await loadLastMeterReading();

  await loadSummary();

  await loadLastCycleSummary();
}

// Bind buttons
const joinBtn =
  document.getElementById(
    "joinBtn"
  );

if (joinBtn) {

  joinBtn.addEventListener(
    "click",
    () =>
      handleAction(
        "JOIN"
      )
  );

}

const exitBtn =
  document.getElementById(
    "exitBtn"
  );

if (exitBtn) {

  exitBtn.addEventListener(
    "click",
    () =>
      handleAction(
        "EXIT"
      )
  );

}

// Initial load
loadActiveUsers();

loadLastMeterReading();

loadSummary();

loadLastCycleSummary();