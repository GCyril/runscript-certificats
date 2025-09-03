// Importation des modules nécessaires
const express = require('express');
const bodyParser = require('body-parser');

const fs = require('fs-extra');
const axios = require('axios');
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

// --- CONFIGURATION AWS S3 ---
// Créez une instance du client S3 v3
const s3Client = new S3Client({
    region: S3_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
    },
});

// =====================================

const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Endpoint pour tester la connexion à l'API RunScript
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

        const response = await axios.post(
            'https://runscript.typefi.com/api/v2/job',
            testData,
            { auth: auth }
        );

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



// Endpoint pour générer le certificat
app.post('/generate-certificate', async (req, res) => {
    try {
        console.log('✨ Génération de certificat demandée...');
        const { studentName, templateName } = req.body;

        if (!studentName || !templateName) {
            return res.status(400).json({ status: 'ERROR', message: 'Nom de l\'étudiant et nom du modèle sont requis.' });
        }

        const auth = {
            username: RUNSCRIPT_KEY,
            password: RUNSCRIPT_SECRET
        };

        // Données d'entrée pour la tâche RunScript
        const runscriptData = {
            inputs: [
                {
                    name: "eotm.indd",
                    location: {
                        scheme: "s3",
                        bucket: S3_BUCKET,
                        key: `${templateName}.indd`
                    }
                },
                {
                    name: "Brush Script MT Italic.ttf",
                    location: {
                        scheme: "s3",
                        bucket: S3_BUCKET,
                        key: "Brush Script MT Italic.ttf"
                    }
                }
            ],
            outputs: [
                {
                    name: "certificate.pdf",
                    location: {
                        scheme: "s3",
                        bucket: S3_BUCKET,
                        // --- MODIFICATION ICI ---
                        // Ajout du dossier 'certificates/' au chemin du fichier de sortie
                        key: `certificates/${studentName}.pdf`
                        // ------------------------
                    }
                }
            ],
            script: "jsx:script.jsx",
            scriptArgs: [
                {
                    name: "Name",
                    value: studentName
                }
            ],
            metadata: [
                {
                    name: "template",
                    value: templateName
                },
                {
                    name: "recipient",
                    value: studentName
                }
            ]
        };

        // Envoi de la tâche à RunScript
        const response = await axios.post(
            'https://runscript.typefi.com/api/v2/job',
            runscriptData,
            { auth: auth }
        );

        const jobId = response.data._id;
        console.log(`✅ Tâche RunScript soumise avec l'ID: ${jobId}`);

        // Attendre que la tâche soit terminée
        const jobStatus = await new Promise(resolve => {
            const checkStatus = async () => {
                const statusResponse = await axios.get(
                    `https://runscript.typefi.com/api/v2/job/${jobId}`,
                    { auth: auth }
                );

                const status = statusResponse.data.status;
                if (status === 'complete' || status === 'error') {
                    resolve(statusResponse.data);
                } else {
                    setTimeout(checkStatus, 3000); // Vérifier toutes les 3 secondes
                }
            };
            checkStatus();
        });

        if (jobStatus.status === 'error') {
            console.error('❌ Tâche RunScript échouée:', jobStatus);
            return res.status(500).json({ status: 'ERROR', message: 'La génération du certificat a échoué.', details: jobStatus });
        }
        
        // Création d'une URL pré-signée pour le fichier de sortie
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: `certificates/${studentName}.pdf`
        });

        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        
        console.log('✅ Certificat généré et URL signée créée.');

        res.json({
            status: 'OK',
            message: 'Certificat généré avec succès!',
            certificateUrl: signedUrl
        });

    } catch (error) {
        console.error('❌ Erreur de génération:', error.message);
        res.status(500).json({
            status: 'ERROR',
            message: 'Erreur lors de la génération du certificat',
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
    console.log('- API Key: ' + (RUNSCRIPT_KEY ? RUNSCRIPT_KEY.substring(0, 5) + '...' : '...'));
    console.log('- S3 Bucket: ' + S3_BUCKET);
    console.log('- S3 Region: ' + S3_REGION);
});
