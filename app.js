const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_API_KEY
);

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

  // Validation

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

  // Get all events

  const {
    data: allEvents
  } = await supabaseClient
    .from("events")
    .select("*")
    .order(
      "timestamp",
      { ascending: true }
    );

  const isFirstUsage =
    !allEvents ||
    allEvents.length === 0;

  // First usage must start at 0

  if (
    isFirstUsage &&
    meterReading !== 0
  ) {

    alert(
      "First meter reading must be 0"
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

  // Close previous usage segment

  if (
    lastEvent &&
    activeUsers.length > 0 &&
    !isFirstUsage
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

    // Get events between readings

    const {
      data: eventsInRange
    } = await supabaseClient
      .from("events")
      .select("*")
      .gte(
        "meter_reading",
        startMeter
      )
      .lte(
        "meter_reading",
        endMeter
      )
      .order(
        "meter_reading",
        {
          ascending: true
        }
      );

    let segments = [];

    let prevMeter =
      startMeter;

    let currentUsers =
      [...activeUsers];

    for (
      let i = 0;
      i < eventsInRange.length;
      i++
    ) {

      const evt =
        eventsInRange[i];

      if (
        evt.meter_reading ===
        prevMeter
      ) {
        continue;
      }

      segments.push({
        from: prevMeter,
        to: evt.meter_reading,
        users: [...currentUsers],
      });

      if (
        evt.action === "JOIN" &&
        !currentUsers.includes(
          evt.user_name
        )
      ) {

        currentUsers.push(
          evt.user_name
        );

      } else if (
        evt.action === "EXIT"
      ) {

        currentUsers =
          currentUsers.filter(
            u =>
              u !== evt.user_name
          );
      }

      prevMeter =
        evt.meter_reading;
    }

    // Final segment

    if (
      prevMeter < endMeter &&
      currentUsers.length > 0
    ) {

      segments.push({
        from: prevMeter,
        to: endMeter,
        users: [...currentUsers],
      });
    }

    // Save all segments

    for (
      const seg of segments
    ) {

      const unitsUsed =
        Number(
          (
            seg.to -
            seg.from
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
            seg.users.length
          ).toFixed(2)
        );

      // Insert usage segment

      await supabaseClient
        .from(
          "usage_segments"
        )
        .insert({

          start_meter:
            seg.from,

          end_meter:
            seg.to,

          units_used:
            unitsUsed,

          active_users:
            seg.users,

          cost,

          split_per_user:
            splitPerUser,
        });

      // Update totals

      for (
        const user
        of seg.users
      ) {

        const {
          data: existing,
        } =
          await supabaseClient
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
                  seg.users.length
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
                unitsUsed /
                seg.users.length,

            });
        }
      }

      // Telegram notification

      await sendTelegramMessage(
`❄️ AC UPDATE

👥 Users:
${seg.users.join(", ")}

⚡ Units:
${unitsUsed}

💰 Cost:
₹${cost}

👤 Split Per User:
₹${splitPerUser}`
      );
    }
  }

  // Update active users table

  if (action === "JOIN") {

    await supabaseClient
      .from("active_users")
      .insert({
        user_name: userName
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

  // Save event

  await supabaseClient
    .from("events")
    .insert({

      user_name:
        userName,

      action,

      meter_reading:
        meterReading,
    });

  // Flexible exit update

  if (action === "EXIT") {

    const {
      data: prevExit
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

    if (
      prevExit &&
      prevExit.meter_reading <
      meterReading
    ) {

      await supabaseClient
        .from("events")
        .update({

          meter_reading:
            meterReading
        })
        .eq(
          "id",
          prevExit.id
        );
    }
  }

  // Reset field

  document.getElementById(
    "meterReading"
  ).value = "";

  // Reload UI

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