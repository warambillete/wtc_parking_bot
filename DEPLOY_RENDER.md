# Deploy to Render

## Quick Deploy

1. Push your code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com/)
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Use these settings:
   - **Name**: wtc-parking-bot
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free tier is fine

## Environment Variables

Add these in Render Dashboard → Environment:

- `TELEGRAM_BOT_TOKEN` - Your bot token from @BotFather
- `SUPERVISOR_USER_ID` - Your Telegram user ID

## Persistent Storage

The bot uses SQLite database. With the render.yaml config, it will:
- Create a 1GB persistent disk at `/data`
- Store the database file there
- Keep data between deploys

## Manual Setup (Alternative)

If you prefer manual setup without render.yaml:

1. Create Web Service in Render
2. Set build/start commands as above
3. Go to "Disks" tab
4. Add disk:
   - Mount Path: `/data`
   - Size: 1 GB
5. Add environment variables

## Post-Deploy

1. After deploy, send `/setparking 1,2,3,4,5` to your bot
2. The bot will stay running 24/7
3. Database persists across restarts

## Monitor

- Check Logs tab for any errors
- Render provides automatic restarts if bot crashes
- Free tier includes 750 hours/month