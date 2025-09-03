const express = require('express');
const bodyParser = require('body-parser');

const fs = require('fs-extra');
const axios = require('axios');
// Importations de la bibliothèque AWS SDK v3
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// ====== GESTION DES VARIABLES D'ENVIRONNEMENT ======
require('dotenv').config();

const runscriptKey = process.env.RUNSCRIPT_KEY;
const runscriptSecret = process.env.RUNSCRIPT_SECRET;
const s3Bucket = process.env.S3_BUCKET;
const s3Region = process.env.S3_REGION;

// --- CONFIGURATION AWS S3 ---
const AWS = require('aws-sdk');

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: s3Region
});

const s3 = new AWS.S3();
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
    // Le SDK gérera le bon endpoint régional automatiquement
});

app.use(express.static('.'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Fonction pour générer une URL pré-signée pour l'upload (PutObjectCommand) sur S3
async function generateS3UploadUrl(key, contentType) {
    const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ContentType: contentType,
    });
    return getSignedUrl(s3Client, command, { expiresIn: 60 });
}

// Route principale
app.get('/', (req, res) => {
    if (fs.existsSync(__dirname + '/app.html')) {
        res.sendFile(__dirname + '/app.html');
    } else {
        res.send('<h1>Serveur RunScript</h1><p>app.html manquant</p><a href="/test">Tester la connexion</a>');
    }
});

// Route de génération
app.post('/generate', async (req, res) => {
    try {
        console.log('📝 Nouvelle demande de certificat pour:', req.body.name);

        const name = req.body.name;
        const s3Key = `certificates/${Date.now()}_${name.replace(/ /g, '_')}.pdf`;

        // Lire le script JSX
        var script = await fs.readFile('./script.jsx', 'utf8');

        // Générer une URL pré-signée S3 pour l'upload du PDF
        const presignedS3UploadUrl = await generateS3UploadUrl(s3Key, 'application/pdf');
        console.log(`🔗 URL d'upload S3 pré-signée créée pour le compartiment "${S3_BUCKET}".`);
        console.log(`   - URL d'upload: ${presignedS3UploadUrl}`);

        const data = {
            inputs: [
                {
                    href: 'https://dl.dropboxusercontent.com/scl/fi/da7pccjrm2y3ysw92eidr/eotm.indd?rlkey=gwrzrpx9aokqd5b0q9qaaq9p3',
                    path: 'eotm.indd'
                },
                {
                    href: 'https://dl.dropboxusercontent.com/scl/fi/avajg3zr08hzi6n29q7na/eotm.pdf?rlkey=ni38skm462tajczfetbteosc3',
                    path: 'eotm.pdf'
                },
                {
                    href: 'https://dl.dropboxusercontent.com/scl/fi/zh2rz5f4wikkrw1ju2p3h/Brush-Script-MT-Italic.ttf?rlkey=i841j1j8vn2io1ag84sofkkbg',
                    path: 'Document Fonts/Brush Script MT Italic.ttf'
                }
            ],
            outputs: [
                {
                    path: 'certificate.pdf',
                    href: presignedS3UploadUrl
                }
            ],
            args: [
                { name: 'Name', value: name }
            ],
            script: script,
            
        };

        console.log('🚀 Envoi du job à RunScript...');

        const auth = {
            username: RUNSCRIPT_KEY,
            password: RUNSCRIPT_SECRET
        };

        const response = await axios.post(
            'https://runscript.typefi.com/api/v2/job?async=true',
            data,
            { auth: auth }
        );

        const jobId = response.data._id;
        console.log('📋 Job ID:', jobId);

        let attempts = 0;
        const maxAttempts = 30;
        let jobComplete = false;
        let lastJobData = null;

        while (attempts < maxAttempts && !jobComplete) {
            await new Promise(resolve => setTimeout(resolve, 2000));

            const statusResponse = await axios.get(
                'https://runscript.typefi.com/api/v2/job/' + jobId,
                { auth: auth }
            );

            lastJobData = statusResponse.data;
            console.log('⏳ Status:', statusResponse.data.status);

            if (statusResponse.data.status === 'complete' || statusResponse.data.status === 'completed') {
                jobComplete = true;
                console.log('✅ Job terminé!');
            } else if (statusResponse.data.status === 'failed') {
                console.error("❌ Job failed full response:", statusResponse.data);
                const errorLog = statusResponse.data.log || statusResponse.data.error || "Unknown error";
                throw new Error(`Job échoué: ${errorLog}`);
            } else if (statusResponse.data.status === 'inProgress') {
                console.log('   Progression...', attempts + '/' + maxAttempts);
            }

            attempts++;
        }

        if (!jobComplete) {
            const errorLog = lastJobData?.log || "Timeout without logs";
            throw new Error(`Timeout - le job prend trop de temps. Dernier log: ${errorLog}`);
        }

        console.log('📦 Récupération du PDF depuis S3...');

        const getObjectCommand = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key
        });

        const getObjectResponse = await s3Client.send(getObjectCommand);

        const streamToBuffer = (stream) =>
            new Promise((resolve, reject) => {
                const chunks = [];
                stream.on("data", chunk => chunks.push(chunk));
                stream.on("error", reject);
                stream.on("end", () => resolve(Buffer.concat(chunks)));
            });

        const pdfBuffer = await streamToBuffer(getObjectResponse.Body);

        console.log('✅ PDF récupéré avec succès depuis S3');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${name}_certificate.pdf"`);
        res.send(pdfBuffer);
        console.log('✅ PDF envoyé au client');

    } catch (error) {
        console.error('❌ Erreur:', error.message);

        res.status(500).json({
            error: 'Erreur lors de la génération',
            details: error.message
        });
    }
});

// Route de test
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





// Démarrer le serveur
app.listen(port, () => {
    console.log('');
    console.log('🚀 Serveur RunScript démarré !');
    console.log('================================');
    console.log('📄 Interface: http://localhost:' + port);
    console.log('🧪 Test API: http://localhost:' + port + '/test');
    console.log('');
    console.log('Configuration:');
    console.log('- API Key: ' + (RUNSCRIPT_KEY ? RUNSCRIPT_KEY.substring(0, 5) + '...' : '❌ Manquante'));
    console.log('- Fichiers: AWS S3');
    console.log('================================');
});
