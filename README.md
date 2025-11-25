<<<<<<< HEAD
# 🌾 UCF Agri-Bot – WhatsApp AI Chatbot

An intelligent WhatsApp chatbot named "Sam" for UCF Fertilizers that automates product information, shop locator, farming tips, and premium AI services like crop diagnosis and soil interpretation.

![Node.js](https://img.shields.io/badge/Node.js-v16+-green)
![WhatsApp](https://img.shields.io/badge/WhatsApp-Web.js-25D366)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4-412991)
![Hugging Face](https://img.shields.io/badge/Hugging%20Face-AI-FFD21E)

---

## 🎯 Features

### 🟢 Basic Features (Free)
- **Welcome & User Registration** - Greets users and saves their information
- **Product Q&A** - Instant answers about UCF fertilizers and products
- **Farming Tips** - Daily agricultural advice and best practices
- **Shop Locator** - Find nearest UCF dealers using GPS location
- **Expert Help** - Connect with agronomists for personalized support

### 💎 Premium Features (Verified Customers)
- **Receipt Verification** - OCR-based purchase verification system
- **Crop Diagnosis** - AI-powered plant disease detection from photos
- **Soil Analysis** - Soil health interpretation and recommendations
- **Exclusive PDFs** - Access to premium farming guides and resources
- **Priority Support** - Fast-track expert consultation

---

## ⚙️ Tech Stack

- **Backend**: Node.js + Express
- **WhatsApp**: whatsapp-web.js
- **AI/ML**: 
  - OpenAI GPT-4 for natural language understanding
  - Hugging Face OCR (Receipt text extraction)
  - MobileNet V2 Plant Disease Identification
- **Maps**: Google Maps API for shop location
- **Storage**: Local JSON files (ready for MongoDB migration)

---

## 📁 Project Structure

```
agri-bot/
├── src/
│   ├── bot.js                 # Main WhatsApp bot logic
│   ├── helpers/
│   │   ├── gpt.js            # OpenAI GPT integration
│   │   ├── ocr.js            # Hugging Face OCR for receipts
│   │   ├── plantAI.js        # Plant disease detection
│   │   ├── maps.js           # Google Maps shop locator
│   │   └── utils.js          # Utility functions
│   └── data/
│       ├── products.json     # Product catalog
│       ├── shops.json        # Retailer/shop list
│       ├── tips.json         # Farming tips database
│       ├── users.json        # User profiles
│       └── receipts.json     # Receipt verification records
├── temp/                      # Temporary image storage
├── .env.example              # Environment variables template
├── .gitignore
├── package.json
└── README.md
```

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js v16 or higher
- WhatsApp account
- API Keys:
  - OpenAI API Key
  - Hugging Face API Key
  - Google Maps API Key (optional)

### Step 1: Clone & Install

```bash
# Navigate to project directory
cd agri-bot

# Install dependencies
npm install
```

### Step 2: Configure Environment Variables

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```env
# OpenAI API Key
OPENAI_API_KEY=sk-your-openai-api-key-here

# Hugging Face API Key
HF_API_KEY=hf_your-huggingface-api-key-here

# Google Maps API Key
GOOGLE_MAPS_KEY=your-google-maps-api-key-here

# Agronomist WhatsApp Number (with country code)
AGRONOMIST_NUMBER=+91XXXXXXXXXX

# Session Name for WhatsApp
SESSION_NAME=UCF_AGRIBOT

# Port for Express server (optional)
PORT=3000
```

### Step 3: Get API Keys

#### OpenAI API Key
1. Visit [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in
3. Go to API Keys section
4. Create a new API key
5. Copy and paste into `.env`

#### Hugging Face API Key
1. Visit [Hugging Face](https://huggingface.co/)
2. Sign up or log in
3. Go to Settings → Access Tokens
4. Create a new token
5. Copy and paste into `.env`

#### Google Maps API Key (Optional)
1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Maps JavaScript API
4. Create credentials (API Key)
5. Copy and paste into `.env`

### Step 4: Run the Bot

```bash
# Start the bot
npm start

# Or use nodemon for development
npm run dev
```

### Step 5: Scan QR Code

1. When the bot starts, a QR code will appear in the terminal
2. Open WhatsApp on your phone
3. Go to Settings → Linked Devices → Link a Device
4. Scan the QR code
5. Wait for "✅ UCF Agri-Bot is ready!" message

---

## 📱 How to Use

### For Users (Farmers)

1. **Activate Bot**: Send "crop" to activate the bot (required first step)
2. **Start Conversation**: Bot will ask for your name
3. **Main Menu**: Choose from 6 options:
   - 1️⃣ Crop Diagnosis (Premium)
   - 2️⃣ Farming Tips
   - 3️⃣ Find Shop
   - 4️⃣ Expert Help
   - 5️⃣ Product Q&A
   - 6️⃣ Premium Access

3. **Get Premium Access**:
   - Select option 6 or send any premium feature request
   - Upload a clear photo of your UCF purchase receipt
   - Bot verifies the receipt automatically
   - Get 3 months of premium access

4. **Use Premium Features**:
   - Send crop photos for disease diagnosis
   - Get AI-powered treatment recommendations
   - Access exclusive farming guides

---

## 🤖 Bot Conversation Flow

### Basic Flow
```
User: crop
Bot: 🌾 UCF Agri-Bot Activated!
     Welcome! I'm Sam, your agricultural assistant.
     May I know your name?
User: Ramesh
Bot: [Shows Main Menu]
User: 2 (Farming Tips)
Bot: [Sends random farming tip]
```

### Premium Verification Flow
```
User: 1 (Crop Diagnosis)
Bot: This is a premium feature. Please upload your receipt.
User: [Sends receipt image]
Bot: Analyzing receipt...
Bot: ✅ Receipt verified! Premium access granted until [date]
```

### Crop Diagnosis Flow
```
User: 1 (Crop Diagnosis)
Bot: Please send a photo of affected crop
User: [Sends crop image]
Bot: Analyzing...
Bot: 🔬 Detected: Leaf Blight (85% confidence)
     [Treatment recommendations]
```

---

## 🔧 Customization

### Add New Products

Edit `src/data/products.json`:

```json
{
  "id": "7",
  "name": "UCF Super Grow",
  "npk": "15:15:15",
  "description": "All-purpose fertilizer",
  "category": "NPK Fertilizer",
  "price": "₹900/kg",
  "usage": "Apply 2kg per acre"
}
```

### Add New Shops

Edit `src/data/shops.json`:

```json
{
  "id": "6",
  "name": "New Agro Store",
  "address": "123 Main St, City",
  "phone": "+91 9876543215",
  "latitude": 19.9999,
  "longitude": 73.7777,
  "owner": "Owner Name",
  "timing": "8:00 AM - 8:00 PM"
}
```

### Add New Farming Tips

Edit `src/data/tips.json`:

```json
[
  "Your new farming tip here 🌱",
  "Another helpful tip 🌾"
]
```

---

## 🧪 Testing

### Test Basic Features
1. Send "hi" to start
2. Try each menu option (1-6)
3. Ask product questions
4. Share location for shop finder

### Test Premium Features
1. Request crop diagnosis
2. Upload a test receipt image
3. After verification, upload crop images
4. Check diagnosis results

### Test Expert Help
1. Select option 4
2. Provide name and email
3. Describe issue
4. Verify message forwarding

---

## 📊 Data Storage

Currently using JSON files for data storage:

- **users.json** - User profiles and premium status
- **receipts.json** - Verified receipt records
- **products.json** - Product catalog
- **shops.json** - Retailer locations
- **tips.json** - Farming tips database

### Migration to MongoDB (Future)

The code is structured to easily migrate to MongoDB:

1. Replace `loadData()` and `saveData()` in `utils.js`
2. Connect to MongoDB
3. Create collections for each JSON file
4. Update CRUD operations

---

## 🔒 Security Best Practices

1. **Never commit `.env` file** - Contains sensitive API keys
2. **Receipt verification** - Each receipt can only be used once
3. **Premium expiry** - Automatic 3-month expiration
4. **Rate limiting** - Consider adding rate limits for API calls
5. **Image cleanup** - Temporary images deleted after processing

---

## 🐛 Troubleshooting

### QR Code Not Appearing
- Check internet connection
- Ensure port 3000 is not in use
- Try deleting `.wwebjs_auth` folder and restart

### OCR Not Working
- Verify Hugging Face API key
- Check image quality (clear, well-lit)
- Wait for model to load (first request may take 20s)

### Location Not Working
- Ensure Google Maps API key is valid
- Check if Maps JavaScript API is enabled
- Verify shops.json has valid coordinates

### Bot Not Responding
- Check console for errors
- Verify all API keys are correct
- Ensure WhatsApp Web is connected
- Check internet connection

---

## 📈 Future Enhancements

- [ ] MongoDB integration for scalability
- [ ] Admin dashboard for managing products/shops
- [ ] Multi-language support (Hindi, Marathi, etc.)
- [ ] Voice message support
- [ ] Satellite crop monitoring integration
- [ ] Payment gateway for premium subscriptions
- [ ] Analytics dashboard for usage tracking
- [ ] Bulk messaging for promotions
- [ ] Webhook integration for real-time updates

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

## 👨‍💻 Developer

**UCF Fertilizers Tech Team**

For support or queries:
- 📧 Email: support@ucffertilizers.com
- 📞 Phone: +91-XXXXXXXXXX
- 🌐 Website: www.ucffertilizers.com

---

## 🙏 Acknowledgments

- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) - WhatsApp Web API
- [OpenAI](https://openai.com/) - GPT-4 API
- [Hugging Face](https://huggingface.co/) - AI Models
- [Google Maps](https://developers.google.com/maps) - Location Services

---

**Made with ❤️ for Indian Farmers 🌾**
=======
# UCF-Agri-Website-Bot
Created website and bot for UCF Fertilizers to manage users using the bot, the bot contains script detection using hugging face ng ocr, once verified, user can use premium featues which includes crop detection by sending images and the bot detects issues in the crop, analyzing soil reports , sending pdfs, daily tips (cron job) opening QR from bill.
>>>>>>> 842d79ffe53d2cf1fb8724cc14349b6a9643a843
