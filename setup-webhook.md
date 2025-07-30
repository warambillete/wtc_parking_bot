# 🔧 Webhook Setup Instructions

## ✅ **SOLUTION: Switch from Polling to Webhooks**

The 409 conflicts happen because **multiple polling instances** can't coexist. **Webhooks eliminate this problem entirely** because there's only one HTTP endpoint receiving updates.

## 🚀 **Steps to Deploy Webhook Bot**

### **1. Add Environment Variable in Render**

Go to your Render dashboard and add this environment variable:

```
RENDER_EXTERNAL_URL = https://your-service-name.onrender.com
```

**To find your URL:**
- Go to your Render service dashboard
- Look for the URL at the top (something like `https://wtc-parking-bot-xxx.onrender.com`)
- Copy that URL and add it as `RENDER_EXTERNAL_URL`

### **2. Deploy the Changes**

The bot will now:
- ✅ Use **webhooks instead of polling** (no more 409 conflicts!)
- ✅ Still have all the same functionality
- ✅ Be more reliable and faster
- ✅ Handle multiple users simultaneously without issues

### **3. Expected Logs**

You should see:
```
🚀 Starting WTC Parking Bot (WEBHOOK MODE)...
🌐 Webhook server running on port 3000
🗑️ Deleted existing webhook
✅ Webhook set to: https://your-app.onrender.com/webhook/YOUR_TOKEN
📡 Webhook info: { "url": "...", "has_custom_certificate": false, ... }
```

### **4. Test the Bot**

After deployment:
1. Message your bot in Telegram
2. Try: `estado`, `voy mañana`, etc.
3. No more 409 errors! 🎉

## 🔄 **If You Need to Go Back to Polling**

Use `npm run start:polling` instead of `npm start`

## 🧪 **Local Testing**

For local development, the webhook bot will still work but you'll need ngrok or similar for testing with real Telegram webhooks.

---

**This webhook approach completely eliminates the 409 conflict problem!**