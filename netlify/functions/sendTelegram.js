exports.handler = async (event) => {

  try {

    const body =
      JSON.parse(event.body);

    const response =
      await fetch(
`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({

            chat_id:
              process.env.TELEGRAM_CHAT_ID,

            text:
              body.message,

          }),
        }
      );

    const data =
      await response.json();

    return {

      statusCode: 200,

      body: JSON.stringify(
        data
      ),
    };

  } catch (err) {

    return {

      statusCode: 500,

      body: JSON.stringify({
        error:
          err.message,
      }),
    };
  }
};