const supabaseClient =
  supabase.createClient(
    SUPABASE_URL,
    SUPABASE_API_KEY
  );

// async function sendTelegramMessage(message) {

//   try {

//     await fetch(
//       `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
//       {
//         method: "POST",

//         headers: {
//           "Content-Type":
//             "application/json",
//         },

//         body: JSON.stringify({
//           chat_id: TELEGRAM_CHAT_ID,

//           text: message,
//         }),
//       }
//     );

//   } catch (err) {

//     console.error(
//       "Telegram Error:",
//       err
//     );

//   }
// }

async function sendTelegramMessage(message) {

  try {

    await fetch(
      "/.netlify/functions/sendTelegram",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          message,
        }),
      }
    );

  } catch (err) {

    console.error(
      err
    );
  }
}

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
        ${Number(user.total_units).toFixed(2)}

        <br>

        Amount:
        ₹${Number(user.total_amount).toFixed(2)}

      </div>
    `;

  });
}

function calculateBilling(
  startMeter,
  endMeter,
  activeUsers
) {

  const unitsUsed =
    Number(
      (
        endMeter - startMeter
      ).toFixed(2)
    );

  const cost =
    Number(
      (
        unitsUsed * UNIT_PRICE
      ).toFixed(2)
    );

  const splitPerUser =
    Number(
      (
        cost /
        activeUsers.length
      ).toFixed(2)
    );

  return {
    unitsUsed,
    cost,
    splitPerUser,
  };
}

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

  if (!meterReading) {

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

  // Get active users

  const {
    data: activeUsersData,
  } = await supabaseClient
    .from("active_users")
    .select("*");

  const activeUsers =
    activeUsersData.map(
      (u) => u.user_name
    );

  // Duplicate join check

  if (
    action === "JOIN" &&
    activeUsers.includes(userName)
  ) {

    alert(
      "User already active"
    );

    return;
  }

  // Invalid exit check

  if (
    action === "EXIT" &&
    !activeUsers.includes(userName)
  ) {

    alert(
      "User not active"
    );

    return;
  }

  // Get last event

  const {
    data: lastEvent,
  } = await supabaseClient
    .from("events")
    .select("*")
    .order(
      "timestamp",
      {
        ascending: false,
      }
    )
    .limit(1)
    .single();

  // Close previous segment

  if (
    lastEvent &&
    activeUsers.length > 0
  ) {

    const startMeter =
      Number(
        lastEvent.meter_reading
      );

    const endMeter =
      meterReading;

    if (
      endMeter <= startMeter
    ) {

      alert(
        "Meter reading must increase"
      );

      return;
    }

    const billing =
      calculateBilling(
        startMeter,
        endMeter,
        activeUsers
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
          billing.unitsUsed,

        active_users:
          activeUsers,

        cost:
          billing.cost,

        split_per_user:
          billing.splitPerUser,
      });

    // Update totals

    for (
      const user
      of activeUsers
    ) {

      const {
        data: existing,
      } = await supabaseClient
        .from("user_totals")
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
              billing.splitPerUser,

            total_units:
              Number(
                existing.total_units
              ) +
              (
                billing.unitsUsed /
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
              billing.splitPerUser,

            total_units:
              billing.unitsUsed /
              activeUsers.length,

          });

      }
    }

    await sendTelegramMessage(
`❄️ AC UPDATE

👤 User:
${userName}

🚪 Action:
${action}

⚡ Units:
${billing.unitsUsed}

💰 Cost:
₹${billing.cost}

👥 Split:
₹${billing.splitPerUser}`
    );
  }

  // Update active users

  if (action === "JOIN") {

    await supabaseClient
      .from("active_users")
      .insert({
        user_name:
          userName,
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

  // Log event

  await supabaseClient
    .from("events")
    .insert({

      user_name:
        userName,

      action,

      meter_reading:
        meterReading,

    });

  document.getElementById(
    "meterReading"
  ).value = "";

  await loadActiveUsers();

  await loadSummary();
}

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

loadActiveUsers();

loadSummary();