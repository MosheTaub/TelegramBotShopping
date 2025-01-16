const { Telegraf } = require("telegraf");
const db = require("./db");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const ADMIN_ID = 702413165;
let user;
let state = {};

bot.use(async (ctx, next) => {
  const telegramId = ctx.from.id;

  // Check if the user is banned
  const banCheck = await db.query(
    "SELECT * FROM shirt_bot.banned_users WHERE telegram_id = $1",
    [telegramId]
  );

  if (banCheck.rows.length > 0) {
    // Block banned users universally
    return ctx.reply("You are banned from using this bot.");
  }

  // Proceed if the user is not banned
  return next();
});

// Handle /start command
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;

  const name = ctx.from.first_name + " " + ctx.from.last_name;

  await db.query(
    `INSERT INTO shirt_bot.users (telegram_id, name) VALUES ($1, $2) ON CONFLICT (telegram_id) DO NOTHING`,
    [telegramId, name]
  );

  // Check if the user already has a phone number and address
  const res = await db.query(
    "SELECT phone, address FROM shirt_bot.users WHERE telegram_id = $1",
    [telegramId]
  );

  user = res.rows[0];

  // If phone or address is missing, ask for them
  if (user.phone && user.address) {
    ctx.reply("Welcome back! You can now browse the products.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Browse Products", callback_data: "view_products" }],
        ],
      },
    });
  } else {
    if (!user.phone) {
      ctx.reply("Please share your phone number:");
      state[telegramId] = "phone";
    } else {
      ctx.reply("Welcome back! Please send your address.");
      state[telegramId] = "address";
    }
  }
});

// Admin main menu
bot.command("admin", async (ctx) => {
  if (ctx.from.id === ADMIN_ID) {
    ctx.reply("Admin Menu:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "View Pending Orders", callback_data: "view_orders" },
            { text: "Manage Products", callback_data: "manage_products" },
            { text: "Ban User", callback_data: "ban_user" },
            { text: "Unban User", callback_data: "unban_user" },
          ],
          [{ text: "Upload New Product", callback_data: "upload_product" }],
        ],
      },
    });
  } else {
    ctx.reply("You are not authorized to access the admin menu.");
  }
});

// Handle callback queries (buttons)
bot.on("callback_query", async (ctx) => {
  const telegramId = ctx.from.id;

  if (ctx.callbackQuery.data.startsWith("remove_product_")) {
    const productId = parseInt(ctx.callbackQuery.data.split("_")[2]);
    await db.query("DELETE FROM shirt_bot.products WHERE id = $1;", [
      productId,
    ]);
    ctx.reply("Product has been removed.");
  }

  // Admin panel handling
  if (telegramId === ADMIN_ID) {
    if (ctx.callbackQuery.data === "ban_user") {
      ctx.reply("Please send the Telegram ID of the user you want to ban.");
      state[telegramId] = "ban_user";
    }

    if (ctx.callbackQuery.data === "unban_user") {
      ctx.reply("Please send the Telegram ID of the user you want to unban.");
      state[telegramId] = "unban_user";
    }

    if (ctx.callbackQuery.data === "view_orders") {
      const res = await db.query(
        "SELECT * FROM shirt_bot.orders WHERE status = 'Pending'"
      );

      if (res.rows.length === 0) {
        ctx.reply("No pending orders.");
      } else {
        res.rows.forEach((order) => {
          ctx.reply(
            `Order ID: ${order.id}\nUser ID: ${order.user_id}\nTotal Price: $${order.total_price}\nStatus: ${order.status}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "Mark as Shipped",
                      callback_data: `ship_order_${order.id}`,
                    },
                  ],
                ],
              },
            }
          );
        });
      }
    }

    if (ctx.callbackQuery.data.startsWith("ship_order_")) {
      const orderId = parseInt(ctx.callbackQuery.data.split("_")[2]);
      await db.query(
        "UPDATE shirt_bot.orders SET status = 'Shipped' WHERE id = $1",
        [orderId]
      );
      ctx.reply("The order has been marked as shipped.");
    }

    if (ctx.callbackQuery.data === "manage_products") {
      const res = await db.query("SELECT * FROM shirt_bot.products");

      if (res.rows.length === 0) {
        ctx.reply("No products available.");
      } else {
        res.rows.forEach((product) => {
          ctx.reply(
            `Product: ${product.name}\nPrice: $${product.price}\nStock: ${product.stock}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "Remove Product",
                      callback_data: `remove_product_${product.id}`,
                    },
                    // {
                    //   text: "Edit Product",
                    //   callback_data: `edit_product_${product.id}`,
                    // },
                  ],
                ],
              },
            }
          );
        });
      }
    }

    // if (ctx.callbackQuery.data.startsWith("edit_product_")) {
    //   const productId = parseInt(ctx.callbackQuery.data.split("_")[2]);

    //   // Allow the admin to edit product details (name, price, stock, etc.)
    //   // This can be expanded into another series of buttons asking for each field.
    //   ctx.reply("Send the new product details (Name, Price, Stock).", {
    //     reply_markup: {
    //       inline_keyboard: [[{ text: "Cancel", callback_data: "cancel_edit" }]],
    //     },
    //   });
    // }

    if (ctx.callbackQuery.data === "upload_product") {
      ctx.reply(
        "Send the product details (Name;Description;Price;Image_url;Size;Color;Stock)"
      );
      state[telegramId] = "upload_product";
    }
  }

  // User actions (Browse products)
  if (ctx.callbackQuery.data === "view_products") {
    // Send the list of available products
    const res = await db.query(
      "SELECT * FROM shirt_bot.products WHERE stock > 0"
    );

    if (res.rows.length === 0) {
      ctx.reply("No products available at the moment.");
    } else {
      res.rows.forEach((product) => {
        // Send each product with an "Order" button
        ctx.replyWithPhoto(product.image_url, {
          caption: `${product.name}\n${product.description}\nPrice: $${product.price}\nSize: ${product.size}\nStock: ${product.stock}`,
          reply_markup: {
            inline_keyboard: [
              [{ text: "Order", callback_data: `order_${product.id}` }],
            ],
          },
        });
      });
    }
  }

  // Handle ordering a product
  if (ctx.callbackQuery.data.startsWith("order_")) {
    const productId = parseInt(ctx.callbackQuery.data.split("_")[1]);

    // Get product details from the database
    const productRes = await db.query(
      "SELECT * FROM shirt_bot.products WHERE id = $1",
      [productId]
    );
    const product = productRes.rows[0];

    // Ask for confirmation
    ctx.reply(
      `Are you sure you want to order this product?\n\n` +
        `Product: ${product.name}\n` +
        `Description: ${product.description}\n` +
        `Price: $${product.price}\n` +
        `Size: ${product.size}\n` +
        `Stock: ${product.stock}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Yes, order this",
                callback_data: `confirm_order_${product.id}`,
              },
              { text: "No, cancel", callback_data: "cancel_order" },
            ],
          ],
        },
      }
    );
  }

  // Handle confirmation of order
  if (ctx.callbackQuery.data.startsWith("confirm_order_")) {
    const productId = parseInt(ctx.callbackQuery.data.split("_")[2]);

    // Get product details from the database
    const productRes = await db.query(
      "SELECT * FROM shirt_bot.products WHERE id = $1",
      [productId]
    );
    const product = productRes.rows[0];

    // Check if there is enough stock
    if (product.stock <= 0) {
      ctx.reply("Sorry, this product is out of stock.");
      return;
    }

    // Insert the order into the database
    const telegramId = ctx.from.id; // Fetch the Telegram user ID
    const userRes = await db.query(
      "SELECT id, name, phone, address FROM shirt_bot.users WHERE telegram_id = $1",
      [telegramId]
    );
    const user = userRes.rows[0];

    if (!user) {
      ctx.reply("User not found.");
      return;
    }

    const orderRes = await db.query(
      "INSERT INTO shirt_bot.orders (user_id, total_price) VALUES ($1, $2) RETURNING id",
      [user.id, product.price]
    );
    const orderId = orderRes.rows[0].id;

    await db.query(
      "INSERT INTO shirt_bot.order_items (order_id, product_id, price) VALUES ($1, $2, $3)",
      [orderId, productId, product.price]
    );

    // Reduce stock by 1 after order
    await db.query(
      "UPDATE shirt_bot.products SET stock = stock - 1 WHERE id = $1",
      [productId]
    );

    // Send confirmation message
    ctx.reply(
      `Your order for ${product.name} has been confirmed! We will process it soon.`
    );

    // Send alert to the admin
    await ctx.telegram.sendMessage(
      ADMIN_ID, // Admin's Telegram ID
      `New order received!\nOrder ID: ${orderId}\nProduct: ${product.name}\nUser: ${user.name}\nPhone: ${user.phone}\nAddress: ${user.address}\nPrice: $${product.price}`
    );
  }

  // Handle canceling the order
  if (ctx.callbackQuery.data === "cancel_order") {
    ctx.reply("Your order has been canceled.");
  }

  // Acknowledge the callback
  ctx.answerCbQuery();
});

bot.on("text", async (ctx) => {
  const telegramId = ctx.from.id;

  if (state[telegramId] === "upload_product") {
    const details = ctx.message.text.split(";");
    try {
      await db.query(
        "INSERT INTO shirt_bot.products (name, description, price, image_url, size, color, stock) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          details[0],
          details[1],
          details[2],
          details[3],
          details[4],
          details[5],
          details[6],
        ]
      );
      ctx.reply("Product has been added.");
      state[telegramId] = null;
    } catch (err) {
      ctx.reply(
        "Error adding product. try providing the details in the correct format."
      );
    }
  } else if (
    state[telegramId] === "phone" &&
    ctx.message.text.match(/^\d{10}$/)
  ) {
    await db.query(
      "UPDATE shirt_bot.users SET phone = $1 WHERE telegram_id = $2",
      [ctx.message.text, telegramId]
    );
    state[telegramId] = "address";
    ctx.reply("Please send your address.");
  } else if (state[telegramId] === "address") {
    await db.query(
      "UPDATE shirt_bot.users SET address = $1 WHERE telegram_id = $2",
      [ctx.message.text, telegramId]
    );
    state[telegramId] = null;
    ctx.reply("Thank you! You can now browse the products.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Browse Products", callback_data: "view_products" }],
        ],
      },
    });
  } else if (state[telegramId] === "ban_user") {
    try {
      const telegramIdToBan = parseInt(ctx.message.text);

      // Insert the user into the banned_users table
      await db.query(
        "INSERT INTO shirt_bot.banned_users (telegram_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [telegramIdToBan]
      );
      ctx.reply(`User ${telegramIdToBan} has been banned.`);
    } catch (err) {
      ctx.reply("Error banning user. Please provide a valid Telegram ID.");
    }
  } else if (state[telegramId] === "unban_user") {
    try {
      const telegramIdToUnban = parseInt(ctx.message.text);

      // Remove the user from the banned_users table
      await db.query(
        "DELETE FROM shirt_bot.banned_users WHERE telegram_id = $1",
        [telegramIdToUnban]
      );
      ctx.reply(`User ${telegramIdToUnban} has been unbanned.`);
    } catch (err) {
      ctx.reply("Error unbanning user. Please provide a valid Telegram ID.");
    }
  } else {
    ctx.reply("/start to begin.");
  }
});

// Launch the bot
bot.launch();
console.log("Bot is running...");
