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
// C'est la configuration v2 de AWS SDK, que vous avez aussi dans votre code original.
// Pour ne pas créer de confusion, nous allons la commenter, car vous n'en avez pas besoin.
// const AWS = require('aws-sdk');
// AWS.config.update({
//     accessKeyId: AWS_ACCESS_KEY_ID,
//     secretAccessKey: AWS_SECRET_ACCESS_KEY,
//     region: S3_REGION
// });
// const s3 = new AWS.S3();
// =====================================

const app = express();
const port = 3000;

// Créez une instance du client S3 v3
// Enlève l'endpoint forcé pour permettre au SDK d'utiliser le bon endpoint régional.
const s3Client = new S3Client({
    region: S3_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
    },
});

app.use(bodyParser.json());

// Routes
// Test de l'API RunScript
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
