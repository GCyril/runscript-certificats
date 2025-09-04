const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// ====== GESTION DES VARIABLES D'ENVIRONNEMENT ======
const RUNSCRIPT_KEY = process.env.RUNSCRIPT_KEY;
const RUNSCRIPT_SECRET = process.env.RUNSCRIPT_SECRET;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
// =================================================

const app = express();
const port = process.env.PORT || 3000;

// Utiliser express.static pour servir les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// --- CONFIGURATION AWS S3 ---
const s3Client = new S3Client({
    region: S3_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
    },
});
// =============================

// Fonction pour générer une URL pré-signée pour l'upload (PutObjectCommand) sur S3
async function generateS3UploadUrl(key, contentType) {
    const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ContentType: contentType,
    });
    return getSignedUrl(s3Client, command, { expiresIn: 60 });
}

// Fonction pour générer une URL pré-signée pour le téléchargement (GetObjectCommand) depuis S3
async function generateS3DownloadUrl(key) {
    const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
    });
    return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // URL valide pour 1 heure
}

// Route pour la page d'accueil (sert index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route pour la génération du certificat
app.post('/generate', async (req, res) => {
    try {
        const name = req.body.name;

        if (!name) {
            console.error('❌ Erreur: Le nom n\'est pas fourni dans la requête.');
            return res.status(400).json({
                error: 'Nom manquant',
                details: 'Veuillez fournir un nom dans le corps de la requête.'
            });
        }

        console.log('📝 Nouvelle demande de certificat pour:', name);
        const s3Key = `certificates/${Date.now()}_${name.replace(/ /g, '_')}.pdf`;

        // Lire le script JSX
        const script = await fs.readFile(path.join(__dirname, 'script.jsx'), 'utf8');

        // Générer une URL pré-signée S3 pour l'upload du PDF
        const presignedS3UploadUrl = await generateS3UploadUrl(s3Key, 'application/pdf');
        console.log(`🔗 URL d'upload S3 pré-signée créée pour le compartiment "${S3_BUCKET}".`);

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

        // Stocker la clé S3 pour le suivi de l'état
        jobStatus[jobId] = { s3Key: s3Key, status: 'submitted' };

        res.json({
            status: 'OK',
            message: 'Demande de génération soumise. Veuillez vérifier l\'état du job.',
            jobId: jobId
        });

    } catch (error) {
        console.error('❌ Erreur lors de la génération du certificat:', error.message);
        res.status(500).json({
            error: 'Erreur lors de la génération',
            details: error.message
        });
    }
});

// Route pour vérifier l'état d'un job RunScript et générer l'URL de téléchargement
app.get('/check-status/:jobId', async (req, res) => {
    const { jobId } = req.params;

    try {
        console.log(`🔍 Vérification du statut pour le Job ID: ${jobId}`);

        const auth = {
            username: RUNSCRIPT_KEY,
            password: RUNSCRIPT_SECRET
        };

        const jobResponse = await axios.get(
            `https://runscript.typefi.com/api/v2/job/${jobId}`,
            { auth: auth }
        );
        const jobStatus = jobResponse.data.status;

        if (jobStatus === 'done') {
            const s3Key = jobResponse.data.outputs[0].href.split('?')[0].split('.com/')[1];
            console(`✅ Job ${jobId} terminé. Génération de l'URL de téléchargement pour le fichier ${s3Key}`);
            const downloadUrl = await generateS3DownloadUrl(s3Key);
            res.json({
                status: 'done',
                downloadUrl: downloadUrl
            });
        } else if (jobStatus === 'failed') {
            console.error(`❌ Job ${jobId} a échoué.`);
            res.json({ status: 'failed', message: 'La génération du certificat a échoué.' });
        } else {
            console.log(`⏳ Job ${jobId} en cours...`);
            res.json({ status: 'in-progress' });
        }

    } catch (error) {
        console.error(`❌ Erreur lors de la vérification du statut pour le Job ID ${jobId}:`, error.message);
        res.status(500).json({
            error: 'Erreur de vérification du statut',
            details: error.message
        });
    }
});


// Route de test
app.get('/test', async (req, res) => {
    try {
        console.log('🧪 Test de connexion RunScript...');
        if (!RUNSCRIPT_KEY || !RUNSCRIPT_SECRET) {
            console.error('❌ Erreur: Clés RunScript manquantes!');
            return res.status(500).json({
                status: 'ERROR',
                message: 'Clés API RunScript manquantes. Veuillez vérifier la configuration sur Render.'
            });
        }
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
    console.log(`Serveur en écoute sur le port ${port}`);
    console.log('================================');
});
