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
const S3_BUCKET        = process.env.S3_BUCKET;         // compartiment de sortie (PDFs générés)
const S3_ASSETS_BUCKET = process.env.S3_ASSETS_BUCKET;  // compartiment des assets (indd, fontes, image)
const S3_REGION = process.env.S3_REGION;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
// =================================================

const app = express();
const port = process.env.PORT || 3000;

// Objet pour stocker l'état des jobs.
const jobStatus = {};

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
    // Désactive les checksums automatiques du SDK v3 dans les URLs presignées.
    // Sans ça, le SDK ajoute x-amz-sdk-checksum-algorithm dans les headers signés,
    // et RunScript ne les envoie pas → S3 rejette l'upload (SignatureDoesNotMatch).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
});
// =============================

// Fonction pour générer une URL pré-signée pour l'upload (PutObjectCommand) sur S3
async function generateS3UploadUrl(key) {
    const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        // ContentType retiré : le SDK v3 l'inclut dans la signature, ce qui fait échouer
        // l'upload RunScript si celui-ci n'envoie pas exactement le même Content-Type
    });
    return getSignedUrl(s3Client, command, { expiresIn: 600 }); // 10 minutes
}

// Fonction pour générer une URL pré-signée pour le téléchargement (GetObjectCommand) depuis S3
async function generateS3DownloadUrl(key) {
    const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
    });
    return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // URL valide pour 1 heure
}

// Fonction pour générer une URL pré-signée en lecture (GET) pour les assets du template
// Utilisée par RunScript pour télécharger le .indd, les polices et l'image de fond
async function generateS3AssetUrl(key) {
    const command = new GetObjectCommand({
        Bucket: S3_ASSETS_BUCKET,
        Key: key,
    });
    return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 heure — laisse du temps à RunScript
}

// Route pour la page d'accueil (sert index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route pour la génération du certificat
app.post('/generate', async (req, res) => {
    try {
        const nom  = req.body.nom;
        const date = req.body.date;

        if (!nom || !date) {
            console.error('❌ Erreur: Nom ou date manquant dans la requête.');
            return res.status(400).json({
                error: 'Champs manquants',
                details: 'Veuillez fournir un nom et une date dans le corps de la requête.'
            });
        }

        console.log('📝 Nouvelle demande de certificat pour:', nom, '|', date);
        const s3Key = `certificates/${Date.now()}_${nom.replace(/ /g, '_')}.pdf`;

        // Lire le script JSX
        const script = await fs.readFile(path.join(__dirname, 'certificat.jsx'), 'utf8');

        // Générer une URL pré-signée S3 pour l'upload du PDF
        const presignedS3UploadUrl = await generateS3UploadUrl(s3Key);
        console.log(`🔗 URL d'upload S3 pré-signée créée pour le compartiment "${S3_BUCKET}".`);

        // Générer les URLs presignées GET pour tous les fichiers du template (compartiment S3_ASSETS_BUCKET)
        console.log(`📦 Génération des URLs d'accès aux assets depuis "${S3_ASSETS_BUCKET}"...`);
        const [inddUrl, tifUrl, font1Url, font2Url] = await Promise.all([
            generateS3AssetUrl('Commendation-mountains.indd'),
            generateS3AssetUrl('fond-mountains.tif'),
            generateS3AssetUrl('opensans.ttf'),
            generateS3AssetUrl('opensans bold.ttf'),
        ]);

        const data = {
            inputs: [
                // Fichier InDesign principal
                { href: inddUrl,  path: 'Commendation-mountains.indd' },
                // Image de fond (liée dans le .indd — doit être dans le même dossier)
                { href: tifUrl,   path: 'fond-mountains.tif' },
                // Polices (InDesign Server cherche dans Document Fonts/ relatif au .indd)
                { href: font1Url, path: 'Document Fonts/opensans.ttf' },
                { href: font2Url, path: 'Document Fonts/opensans bold.ttf' },
            ],
            outputs: [
                {
                    path: 'certificat.pdf',
                    href: presignedS3UploadUrl
                }
            ],
            args: [
                { name: 'Nom',  value: nom  },
                { name: 'Date', value: date }
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

        if (jobStatus === 'complete') { // Corrigé de 'done' à 'complete'
            const s3Key = jobResponse.data.outputs[0].href.split('?')[0].split('.com/')[1];
            console.log(`✅ Job ${jobId} terminé. Génération de l'URL de téléchargement pour le fichier ${s3Key}`);
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


// Route de diagnostic : retourne la réponse complète de l'API RunScript pour un job
// Usage : GET /job-debug/ID_DU_JOB
app.get('/job-debug/:jobId', async (req, res) => {
    const { jobId } = req.params;
    try {
        const auth = { username: RUNSCRIPT_KEY, password: RUNSCRIPT_SECRET };
        const response = await axios.get(
            `https://runscript.typefi.com/api/v2/job/${jobId}`,
            { auth }
        );
        // Retourner la réponse brute complète — inclut status, log, outputs, erreurs
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message, details: error.response?.data });
    }
});


// Route de test S3 : génère une URL pré-signée PUT et tente d'uploader un fichier texte
// Usage : GET /test-upload
// Permet de vérifier que les permissions IAM PutObject fonctionnent correctement
app.get('/test-upload', async (req, res) => {
    try {
        console.log('🧪 Test d\'upload S3...');
        const testKey = `test/${Date.now()}_diagnostic.txt`;
        const uploadUrl = await generateS3UploadUrl(testKey);
        console.log(`🔗 URL pré-signée PUT générée : ${uploadUrl.substring(0, 80)}...`);

        // Tenter d'uploader un petit fichier texte via l'URL pré-signée (comme le ferait RunScript)
        const testContent = Buffer.from(`Test upload depuis Node.js — ${new Date().toISOString()}`);
        const uploadResponse = await axios.put(uploadUrl, testContent);

        console.log(`✅ Upload réussi ! HTTP ${uploadResponse.status}`);
        res.json({
            status: 'OK',
            message: `Upload de test réussi (HTTP ${uploadResponse.status})`,
            key: testKey,
            bucket: S3_BUCKET,
            uploadUrlPreview: uploadUrl.substring(0, 120) + '...'
        });
    } catch (error) {
        const detail = error.response?.data || error.message;
        console.error('❌ Échec de l\'upload S3 :', detail);
        res.status(500).json({
            status: 'ERROR',
            message: 'L\'upload vers S3 a échoué',
            httpStatus: error.response?.status,
            error: error.message,
            s3Response: error.response?.data
        });
    }
});


// Route de test RunScript (synchrone) — retourne la réponse COMPLÈTE pour voir tous les champs
// (notamment le champ "log" avec la sortie de app.consoleout)
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
            script: "app.consoleout('=== TEST app.consoleout ==='); app.consoleout('Heure : ' + new Date().toISOString());",
        };
        // Appel SYNCHRONE (sans ?async=true) pour obtenir le résultat complet directement
        const response = await axios.post(
            'https://runscript.typefi.com/api/v2/job',
            testData,
            { auth: auth }
        );
        console.log('✅ Test RunScript réussi. Réponse complète:', JSON.stringify(response.data));
        // Retourner la réponse brute complète — permet de voir le champ "log" (app.consoleout)
        res.json({
            status: 'OK',
            message: 'Test RunScript réussi — voir rawResponse pour le champ log',
            rawResponse: response.data
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
