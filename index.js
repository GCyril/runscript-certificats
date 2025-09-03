const express = require('express');
const bodyParser = require('body-parser');

const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
// Importations de la bibliothèque AWS SDK v3
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// ====== GESTION DES VARIABLES D'ENVIRONNEMENT ======
require('dotenv').config();

const RUNSCRIPT_KEY = process.env.RUNSCRIPT_KEY;
const RUNSCRIPT_SECRET = process.env.RUNSCRIPT_SECRET;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

const app = express();
const port = 3000;

// Créez une instance du client S3 v3
const s3Client = new S3Client({
    region: S3_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
    },
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ajout de la route pour servir la page HTML de l'interface utilisateur
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Générateur de Certificats</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                body {
                    font-family: sans-serif;
                }
            </style>
        </head>
        <body class="bg-gray-100 p-8">
            <div class="max-w-md mx-auto bg-white p-6 rounded-lg shadow-md">
                <h1 class="text-2xl font-bold mb-4 text-center">Générateur de Certificats</h1>
                <p class="text-gray-600 mb-6 text-center">Entrez un nom pour générer un certificat PDF.</p>

                <div class="mb-4">
                    <label for="recipientName" class="block text-sm font-medium text-gray-700">Nom du destinataire:</label>
                    <input type="text" id="recipientName" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm">
                </div>

                <div class="mb-4">
                    <label for="templateName" class="block text-sm font-medium text-gray-700">Nom du modèle (e.g., eotm):</label>
                    <input type="text" id="templateName" value="eotm" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm">
                </div>

                <div class="flex items-center justify-between">
                    <button id="generateBtn" class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors duration-200">
                        Générer le Certificat
                    </button>
                    <div id="loadingIndicator" class="hidden text-sm text-gray-500">Génération...</div>
                </div>

                <div id="result" class="mt-6 p-4 bg-gray-50 rounded-md">
                    <p class="text-sm text-gray-500">Le certificat généré apparaîtra ici.</p>
                </div>
            </div>

            <script>
                document.getElementById('generateBtn').addEventListener('click', async () => {
                    const recipientName = document.getElementById('recipientName').value;
                    const templateName = document.getElementById('templateName').value;
                    const resultDiv = document.getElementById('result');
                    const loadingIndicator = document.getElementById('loadingIndicator');
                    const generateBtn = document.getElementById('generateBtn');

                    if (!recipientName) {
                        alert('Veuillez entrer un nom de destinataire.');
                        return;
                    }

                    // Affiche le chargement et désactive le bouton
                    resultDiv.innerHTML = '<p class="text-sm text-yellow-600">Génération du certificat en cours...</p>';
                    loadingIndicator.classList.remove('hidden');
                    generateBtn.disabled = true;

                    try {
                        const response = await fetch('/generate-certificate', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ recipientName, templateName }),
                        });

                        const data = await response.json();

                        if (data.status === 'OK') {
                            resultDiv.innerHTML = \`<p class="text-sm text-green-600">Certificat généré avec succès !</p><p class="mt-2"><a href="\${data.pdfUrl}" target="_blank" class="text-blue-500 hover:underline">Ouvrir le Certificat</a></p>\`;
                        } else {
                            resultDiv.innerHTML = \`<p class="text-sm text-red-600">Erreur: \${data.message}</p><p class="text-xs text-red-400 mt-1">Détails: \${data.details}</p>\`;
                        }
                    } catch (error) {
                        resultDiv.innerHTML = \`<p class="text-sm text-red-600">Erreur de connexion au serveur: \${error.message}</p>\`;
                    } finally {
                        // Cache le chargement et réactive le bouton
                        loadingIndicator.classList.add('hidden');
                        generateBtn.disabled = false;
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// Routes existantes pour les APIs
app.get('/test', async (req, res) => {
    try {
        console.log('🧪 Test de connexion RunScript...');
        const auth = {
            username: RUNSCRIPT_KEY,
            password: RUNSCRIPT_SECRET
        };
        const testData = {
            inputs: [],
            outputs: [],
            script: "app.consoleout('Test');",
        };
        const response = await axios.post('https://runscript.typefi.com/api/v2/job', testData, { auth: auth });
        console.log('✅ Test réussi:', response.data);
        res.json({
            status: 'OK',
            message: 'Connexion RunScript réussie!',
            jobId: response.data._id
        });
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        res.status(500).json({
            status: 'ERROR',
            message: 'Erreur de connexion',
            details: error.message
        });
    }
});

// Générer le certificat via RunScript
app.post('/generate-certificate', async (req, res) => {
    try {
        const { recipientName, templateName } = req.body;
        console.log(`🚀 Génération du certificat pour ${recipientName} en utilisant le modèle ${templateName}...`);

        const auth = {
            username: RUNSCRIPT_KEY,
            password: RUNSCRIPT_SECRET
        };

        const jobData = {
            inputs: [
                {
                    name: "eotm.indd",
                    location: {
                        scheme: "s3",
                        bucket: S3_BUCKET,
                        key: `${templateName}.indd`
                    }
                }
            ],
            outputs: [
                {
                    name: "certificate.pdf",
                    location: {
                        scheme: "s3",
                        bucket: S3_BUCKET,
                        key: `certificates/${recipientName}-certificate.pdf`
                    }
                }
            ],
            script: "app.scriptArgs.Name = '" + recipientName + "';\n" + await fs.readFile('script.jsx', 'utf8')
        };

        const response = await axios.post(
            'https://runscript.typefi.com/api/v2/job',
            jobData,
            { auth: auth }
        );

        console.log('✅ Travail soumis:', response.data._id);
        const jobId = response.data._id;

        // Attendre que le travail soit terminé
        let jobStatus = 'pending';
        let jobResult = null;
        let attempt = 0;
        const maxAttempts = 30; // 5 minutes (30 * 10 secondes)

        while (jobStatus !== 'completed' && jobStatus !== 'failed' && attempt < maxAttempts) {
            console.log(`⏳ Attente de l'achèvement du travail... Statut actuel: ${jobStatus}`);
            await new Promise(resolve => setTimeout(resolve, 10000)); // Attendre 10 secondes
            const jobResponse = await axios.get(
                `https://runscript.typefi.com/api/v2/job/${jobId}`,
                { auth: auth }
            );
            jobStatus = jobResponse.data.status;
            jobResult = jobResponse.data;
            attempt++;
        }

        if (jobStatus === 'completed') {
            console.log('🎉 Travail terminé avec succès ! Génération de l\'URL signée...');
            
            const pdfKey = `certificates/${recipientName}-certificate.pdf`;
            const signedUrl = await getSignedUrl(s3Client, new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: pdfKey,
            }), { expiresIn: 3600 });
            
            res.json({
                status: 'OK',
                message: 'Certificat généré et URL signée créée.',
                jobId: jobId,
                pdfUrl: signedUrl
            });
        } else {
            console.error('❌ Échec de la génération du certificat:', jobResult.status);
            console.error('Détails de l\'échec:', jobResult);
            res.status(500).json({
                status: 'ERROR',
                message: 'Échec de la génération du certificat',
                details: jobResult.status,
                log: jobResult.console,
            });
        }
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        res.status(500).json({
            status: 'ERROR',
            message: 'Erreur de connexion',
            details: error.message
        });
    }
});

// Démarrer le serveur
app.listen(port, () => {
    console.log('');
    console.log('🚀 Serveur RunScript démarré !');
    console.log('================================');
    console.log('📄 Interface: http://localhost:' + port);
    console.log('🧪 Test API: http://localhost:' + port + '/test');
    console.log('');
    console.log('Configuration:');
    console.log('- API Key: ' + (RUNSCRIPT_KEY ? RUNSCRIPT_KEY.substring(0, 5) + '...' : 'Pas de clé'));
    console.log('- Bucket S3: ' + S3_BUCKET);
    console.log('- Région S3: ' + S3_REGION);
    console.log('================================');
});
