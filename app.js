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

// Recalculate billing

async function recalculateAllBilling() {

  await supabaseClient
    .from("usage_segments")
    .delete()
    .neq("id", 0);

  await supabaseClient
    .from("user_totals")
    .delete()
    .neq("id", 0);

  const { data: events } =
    await supabaseClient
      .from("events")
      .select("*")
      .order(
        "meter_reading",
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

    } else if (
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
        .single();

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

// Handle join and exit

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

  if (
    meterReading === '' ||
    meterReading === null ||
    isNaN(meterReading)
  ) {

    alert(
      "Enter meter reading"
    );

    return;
  }

  if (meterReading < 0) {

    alert(
      "Invalid meter reading"
    );

    return;
  }

  const {
    data: activeUsersData
  } = await supabaseClient
    .from("active_users")
    .select("*");

  const activeUsers =
    activeUsersData.map(
      (u) => u.user_name
    );

  if (
    action === "JOIN" &&
    activeUsers.includes(userName)
  ) {

    alert(
      "User already active"
    );

    return;
  }

  if (
    action === "EXIT" &&
    !activeUsers.includes(userName)
  ) {

    alert(
      "User not active"
    );

    return;
  }

  const {
    data: allEvents
  } = await supabaseClient
    .from("events")
    .select("*");

  const isFirstUsage =
    !allEvents ||
    allEvents.length === 0;

  if (
    isFirstUsage &&
    meterReading !== 0
  ) {

    alert(
      "First meter reading must be 0"
    );

    return;
  }

  await supabaseClient
    .from("events")
    .insert({

      user_name:
        userName,

      action,

      meter_reading:
        meterReading,
    });

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

  await recalculateAllBilling();

  await sendTelegramMessage(
`❄️ AC UPDATE

👤 User:
${userName}

🚪 Action:
${action}

📟 Meter:
${meterReading}`
  );

  document.getElementById(
    "meterReading"
  ).value = "";

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

  if (
    isNaN(correctMeter)
  ) {

    alert(
      "Enter valid meter"
    );

    return;
  }

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
      "meter_reading",
      {
        ascending: false
      }
    )
    .limit(1)
    .single();

  if (!latestExit) {

    alert(
      "No EXIT record found"
    );

    return;
  }

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

  await recalculateAllBilling();

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

  document.getElementById(
    "meterReading"
  ).value = "";

  await loadSummary();
}

// Button events

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