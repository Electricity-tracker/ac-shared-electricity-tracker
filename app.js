const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_API_KEY
);

// Telegram

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

  container.innerHTML = "";

  data.forEach((user) => {

    container.innerHTML += `
      <span class="user-badge">
        ${user.user_name}
      </span>
    `;

  });
}

// Load summary

async function loadSummary() {

  const { data } =
    await supabaseClient
      .from("user_totals")
      .select("*");

  const container =
    document.getElementById(
      "summary"
    );

  container.innerHTML = "";

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
}

// Recalculate all billing

async function recalculateAllBilling() {

  // Clear old segments

  await supabaseClient
    .from("usage_segments")
    .delete()
    .not("id", "is", null);

  // Clear totals

  await supabaseClient
    .from("user_totals")
    .delete()
    .not("user_name", "is", null);

  // Get all events ordered by timestamp

  const { data: events } =
    await supabaseClient
      .from("events")
      .select("*")
      .order(
        "timestamp",
        {
          ascending: true
        }
      );

  if (
    !events ||
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

    // Apply JOIN

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

    // Apply EXIT

    else if (
      currentEvent.action ===
      "EXIT"
    ) {

      activeUsers =
        activeUsers.filter(
          u =>
            u !==
            currentEvent.user_name
        );
    }

    // Skip if no active users

    if (
      activeUsers.length === 0
    ) {
      continue;
    }

    const startMeter =
      Number(
        currentEvent.meter_reading
      );

    const endMeter =
      Number(
        nextEvent.meter_reading
      );

    // Skip invalid range

    if (
      endMeter <= startMeter
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

    const splitPerUser =
      Number(
        (
          cost /
          activeUsers.length
        ).toFixed(2)
      );

    // Save segment

    await supabaseClient
      .from(
        "usage_segments"
      )
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
          splitPerUser,
      });

    // Update totals

    for (
      const user
      of activeUsers
    ) {

      const {
        data: existing
      } = await supabaseClient
        .from(
          "user_totals"
        )
        .select("*")
        .eq(
          "user_name",
          user
        )
        .maybeSingle();

      if (existing) {

        await supabaseClient
          .from(
            "user_totals"
          )
          .update({

            total_amount:
              Number(
                existing.total_amount
              ) +
              splitPerUser,

            total_units:
              Number(
                existing.total_units
              ) +
              (
                unitsUsed /
                activeUsers.length
              ),

          })
          .eq(
            "user_name",
            user
          );

      } else {

        await supabaseClient
          .from(
            "user_totals"
          )
          .insert({

            user_name:
              user,

            total_amount:
              splitPerUser,

            total_units:
              (
                unitsUsed /
                activeUsers.length
              ),
          });
      }
    }
  }

  await loadSummary();
}

// Handle actions

async function handleAction(action) {

  const userName =
    document.getElementById(
      "userSelect"
    ).value;

  const meterReading =
    Number(
      document.getElementById(
        "meterReading"
      ).value
    );

  // Validate meter

  if (
    meterReading === "" ||
    meterReading === null ||
    isNaN(meterReading)
  ) {

    alert(
      "Enter meter reading"
    );

    return;
  }

  // Validate negative

  if (meterReading < 0) {

    alert(
      "Invalid meter reading"
    );

    return;
  }

  // Get active users

  const {
    data: activeUsersData
  } = await supabaseClient
    .from("active_users")
    .select("*");

  const activeUsers =
    activeUsersData.map(
      (u) => u.user_name
    );

  // Prevent duplicate JOIN

  if (
    action === "JOIN" &&
    activeUsers.includes(userName)
  ) {

    alert(
      "User already active"
    );

    return;
  }

  // Prevent invalid EXIT

  if (
    action === "EXIT" &&
    !activeUsers.includes(userName)
  ) {

    alert(
      "User not active"
    );

    return;
  }

  // Get all events

  const {
    data: allEvents
  } = await supabaseClient
    .from("events")
    .select("*");

  const isFirstUsage =
    !allEvents ||
    allEvents.length === 0;

  // Force first meter to 0

  if (
    isFirstUsage &&
    meterReading !== 0
  ) {

    alert(
      "First meter reading must be 0"
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

  if (action === "JOIN") {

    await supabaseClient
      .from("active_users")
      .insert({

        user_name:
          userName
      });

  } else {

    await supabaseClient
      .from("active_users")
      .delete()
      .eq(
        "user_name",
        userName
      );
  }

  // Recalculate billing

  await recalculateAllBilling();

  // Telegram

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

  // Reload UI

  await loadActiveUsers();

  await loadSummary();
}

// Update missed exit

async function updateMissedExit() {

  const userName =
    document.getElementById(
      "userSelect"
    ).value;

  const correctMeter =
    Number(
      document.getElementById(
        "meterReading"
      ).value
    );

  // Validate meter

  if (
    isNaN(correctMeter)
  ) {

    alert(
      "Enter valid meter"
    );

    return;
  }

  // Find latest exit

  const {
    data: latestExit
  } = await supabaseClient
    .from("events")
    .select("*")
    .eq(
      "user_name",
      userName
    )
    .eq(
      "action",
      "EXIT"
    )
    .order(
      "timestamp",
      {
        ascending: false
      }
    )
    .limit(1)
    .maybeSingle();

  // No exit found

  if (!latestExit) {

    alert(
      "No EXIT record found"
    );

    return;
  }

  // Update exit

  await supabaseClient
    .from("events")
    .update({

      meter_reading:
        correctMeter

    })
    .eq(
      "id",
      latestExit.id
    );

  // Recalculate

  await recalculateAllBilling();

  // Telegram

  await sendTelegramMessage(
`✏️ EXIT UPDATED

👤 User:
${userName}

📟 Correct Exit Meter:
${correctMeter}`
  );

  alert(
    "Exit updated successfully"
  );

  // Clear field

  document.getElementById(
    "meterReading"
  ).value = "";

  await loadSummary();
}

// Join button

document
  .getElementById(
    "joinBtn"
  )
  .addEventListener(
    "click",
    () =>
      handleAction(
        "JOIN"
      )
  );

// Exit button

document
  .getElementById(
    "exitBtn"
  )
  .addEventListener(
    "click",
    () =>
      handleAction(
        "EXIT"
      )
  );

// Update exit button

const updateExitBtn =
  document.getElementById(
    "updateExitBtn"
  );

if (updateExitBtn) {

  updateExitBtn
    .addEventListener(
      "click",
      updateMissedExit
    );
}

// Initial load

loadActiveUsers();

loadSummary();