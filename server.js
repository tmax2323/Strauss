const express = require('express');
const multer = require('multer');
const axios = require('axios'); // Wir nutzen axios für den API-Call
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.static('.'));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- API ENDPUNKT ---
app.post('/api/reklamation', upload.single('document'), async (req, res) => {
    try {
        console.log("Daten empfangen, KI-Analyse startet...");
        const data = req.body;
        const file = req.file;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const promptText = `Analysiere diese Reklamation für Engelbert Strauss und antworte NUR im JSON-Format:
        Kunde: ${data.fullName}, Artikel: ${data.articleNumber}, Grund: ${data.reason}, Bemerkung: ${data.remarks}.
        Struktur: {"prioritaet":"HOCH/MITTEL/NIEDRIG", "plausibel":true/false, "kiEinschaetzung":"...", "kundenAntwort":"...", "supportAntwortEntwurf":"...", "bildAnalyse":"..."}`;

        const result = await model.generateContent([promptText, file ? { inlineData: { data: file.buffer.toString("base64"), mimeType: file.mimetype }} : null].filter(Boolean));
        const aiData = JSON.parse(result.response.text().replace(/```json|
```/g, ""));
        
        console.log(`KI Analyse fertig | Prio: ${aiData.prioritaet}`);

        // --- BREVO API CALL (Ersatzt für Nodemailer/SMTP) ---
        const emailPayload = {
            sender: { name: "Strauss Support Bot", email: "Faimzee@gmail.com" },
            to: [{ email: "Faimzee@gmail.com" }],
            cc: data.testEmail ? [{ email: data.testEmail }] : undefined,
            subject: `[${aiData.prioritaet}] Reklamation: ${data.articleNumber}`,
            textContent: `Kunde: ${data.fullName}\nKI-Check: ${aiData.kiEinschaetzung}\n\nEntwurf:\n${aiData.supportAntwortEntwurf}`,
            attachment: file ? [{
                content: file.buffer.toString('base64'),
                name: file.originalname
            }] : undefined
        };

        try {
            await axios.post('https://api.brevo.com/v3/smtp/email', emailPayload, {
                headers: {
                    'api-key': process.env.BREVO_API_KEY,
                    'Content-Type': 'application/json'
                }
            });
            console.log("Email via Brevo API erfolgreich versandt!");
        } catch (mailError) {
            console.error("Brevo Fehler:", mailError.response ? mailError.response.data : mailError.message);
        }

        res.status(200).json({ status: 'success', aiMsg: aiData.kundenAntwort });

    } catch (error) {
        console.error("Server-Fehler:", error);
        res.status(500).json({ status: 'error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
