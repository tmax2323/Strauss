const express = require('express');
const multer = require('multer');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.static('.'));

// --- GEMINI SETUP ---
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
        
        Struktur der Antwort:
        {
            "prioritaet": "HOCH/MITTEL/NIEDRIG",
            "plausibel": true/false,
            "kiEinschaetzung": "Begründung der Entscheidung",
            "kundenAntwort": "Kurze Bestätigung für die Website",
            "supportAntwortEntwurf": "Vollständige, freundliche E-Mail im Strauss-Stil",
            "bildAnalyse": "Beschreibung des angehängten Bildes (falls vorhanden)"
        }`;

        const requestContent = [promptText];
        if (file) {
            requestContent.push({
                inlineData: {
                    data: file.buffer.toString("base64"),
                    mimeType: file.mimetype
                }
            });
        }

        const result = await model.generateContent(requestContent);
        
        // REPARIERTE LOGIK: Säubert den KI-Text sicher vor dem JSON-Parsing
        const rawText = result.response.text();
        const cleanJson = rawText.replace(/```json|
```/g, "").trim();
        const aiData = JSON.parse(cleanJson);
        
        console.log(`KI Analyse fertig | Prio: ${aiData.prioritaet}`);

        // --- BREVO API CALL (Versand über HTTP statt SMTP) ---
        const emailPayload = {
            sender: { name: "Strauss Support Bot", email: "Faimzee@gmail.com" },
            to: [{ email: "Faimzee@gmail.com" }],
            cc: data.testEmail ? [{ email: data.testEmail }] : undefined,
            subject: `[${aiData.prioritaet}] Neue Reklamation: ${data.articleNumber}`,
            textContent: `Details zur Reklamation:\n
            Kunde: ${data.fullName}
            KI-Einschätzung: ${aiData.kiEinschaetzung}
            Plausibilität: ${aiData.plausibel ? "✅ Ja" : "❌ Nein"}\n
            Vorgeschlagener Entwurf:\n${aiData.supportAntwortEntwurf}`,
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
            console.error("Brevo API Fehler:", mailError.response ? mailError.response.data : mailError.message);
        }

        res.status(200).json({ status: 'success', aiMsg: aiData.kundenAntwort });

    } catch (error) {
        console.error("Server-Fehler:", error);
        res.status(500).json({ status: 'error', message: "Ein interner Fehler ist aufgetreten." });
    }
});

// Render nutzt dynamische Ports, daher nutzen wir process.env.PORT
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
