const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// ====== GESTION DES VARIABLES D'ENVIRONNEMENT ======
const RUNSCRIPT_KEY     = process.env.RUNSCRIPT_KEY;
const RUNSCRIPT_SECRET  = process.env.RUNSCRIPT_SECRET;
const S3_BUCKET         = process.env.S3_BUCKET;         // compartiment de sortie (PDFs générés)
const S3_ASSETS_BUCKET  = process.env.S3_ASSETS_BUCKET;  // compartiment des assets (indd, fontes, image)
const S3_REGION         = process.env.S3_REGION;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
// URL publique de ce serveur Render (ex. https://mon-app.onrender.com)
// Utilisée pour la route /receive-output — RunScript PUT le PDF ici
const APP_URL           = process.env.APP_URL;
// =================================================

const app  = express();
const port = process.env.PORT || 3000;

// ── État en mémoire ────────────────────────────────────────────────────────
const jobStatus     = {};  // jobId  → { s3Key, status }
const pendingUploads = {}; // token  → s3Key  (pour la route /receive-output)
// ──────────────────────────────────────────────────────────────────────────

// --- CONFIGURATION AWS S3 ---
const s3Client = new S3Client({
    region: S3_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
    },
    // Désactive les checksums automatiques du SDK v3 dans les URLs presignées.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
});
// =============================

// Fonction pour générer une URL pré-signée pour l'upload (PutObjectCommand) sur S3
async function generateS3UploadUrl(key) {
    const command = new PutObjectCommand({ Bucket: S3_BUCKET, Key: key });
    return getSignedUrl(s3Client, command, { expiresIn: 600 });
}

// Fonction pour générer une URL pré-signée pour le téléchargement (GetObjectCommand) depuis S3
async function generateS3DownloadUrl(key) {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// Fonction pour générer une URL pré-signée en lecture (GET) pour les assets du template
async function generateS3AssetUrl(key) {
    const command = new GetObjectCommand({ Bucket: S3_ASSETS_BUCKET, Key: key });
    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// ── Middleware statique (avant tout parsing du body) ──────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Route /receive-output — AVANT bodyParser.json ─────────────────────────
// RunScript appelle cette URL en PUT avec le PDF en corps brut.
// On reçoit le PDF et on l'uploade directement vers S3 via le SDK AWS.
// Architecture alternative aux presigned PUT URLs (qui semblent ne pas
// fonctionner avec le mécanisme d'upload interne de RunScript).
app.put('/receive-output/:token', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    const { token } = req.params;
    const s3Key = pendingUploads[token];

    if (!s3Key) {
        console.error(`❌ /receive-output : token inconnu ou expiré : ${token}`);
        return res.status(404).send('Token unknown or expired');
    }

    try {
        const content     = req.body;
        const contentType = req.headers['content-type'] || 'application/pdf';
        console.log(`📥 Réception output RunScript : ${content.length} octets | ${contentType} → ${s3Key}`);

        await s3Client.send(new PutObjectCommand({
            Bucket:      S3_BUCKET,
            Key:         s3Key,
            Body:        content,
            ContentType: contentType,
        }));

        delete pendingUploads[token]; // Nettoyage
        console.log(`✅ PDF uploadé vers S3 : ${s3Key}`);
        res.status(200).send('OK');
    } catch (error) {
        console.error(`❌ /receive-output : erreur upload S3 :`, error.message);
        res.status(500).send('Upload error: ' + error.message);
    }
});

// ── Parsing JSON pour toutes les autres routes ────────────────────────────
app.use(bodyParser.json());

// ── Page d'accueil ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Route principale : génération du certificat ───────────────────────────
app.post('/generate', async (req, res) => {
    try {
        const nom  = req.body.nom;
        const date = req.body.date;

        if (!nom || !date) {
            return res.status(400).json({
                error:   'Champs manquants',
                details: 'Veuillez fournir un nom et une date.'
            });
        }

        console.log('📝 Nouvelle demande de certificat pour:', nom, '|', date);
        const s3Key = `certificates/${Date.now()}_${nom.replace(/ /g, '_')}.pdf`;

        // Lire le script JSX
        const script = await fs.readFile(path.join(__dirname, 'certificat.jsx'), 'utf8');

        // ── Choix de l'URL de sortie ──────────────────────────────────────
        // Si APP_URL est défini, RunScript PUT le PDF sur notre serveur
        // (plus fiable que les presigned PUT URLs S3 qui semblent ignorer
        // les uploads de RunScript).
        // Sinon, fallback sur la presigned PUT URL S3 classique.
        let outputHref;
        if (APP_URL) {
            const token = crypto.randomUUID();
            pendingUploads[token] = s3Key;
            outputHref = `${APP_URL}/receive-output/${token}`;
            console.log(`🔗 Output via serveur Render : ${outputHref}`);
        } else {
            outputHref = await generateS3UploadUrl(s3Key);
            console.log(`🔗 Output via presigned URL S3 (APP_URL non défini)`);
        }

        // Générer les URLs presignées GET pour les assets
        console.log(`📦 Génération des URLs d'accès aux assets depuis "${S3_ASSETS_BUCKET}"...`);
        const [inddUrl, tifUrl, font1Url, font2Url] = await Promise.all([
            generateS3AssetUrl('Commendation-mountains.indd'),
            generateS3AssetUrl('fond-mountains.tif'),
            generateS3AssetUrl('opensans.ttf'),
            generateS3AssetUrl('opensans bold.ttf'),
        ]);

        const data = {
            inputs: [
                { href: inddUrl,  path: 'Commendation-mountains.indd' },
                { href: tifUrl,   path: 'fond-mountains.tif' },
                { href: font1Url, path: 'Document Fonts/opensans.ttf' },
                { href: font2Url, path: 'Document Fonts/opensans bold.ttf' },
            ],
            outputs: [{ path: 'certificat.pdf', href: outputHref }],
            args:    [{ name: 'Nom', value: nom }, { name: 'Date', value: date }],
            script:  script,
        };

        console.log('🚀 Envoi du job à RunScript...');
        const auth     = { username: RUNSCRIPT_KEY, password: RUNSCRIPT_SECRET };
        const response = await axios.post(
            'https://runscript.typefi.com/api/v2/job?async=true',
            data,
            { auth }
        );

        const jobId = response.data._id;
        console.log('📋 Job ID:', jobId);
        jobStatus[jobId] = { s3Key, status: 'submitted' };

        res.json({ status: 'OK', jobId });

    } catch (error) {
        console.error('❌ Erreur /generate :', error.message);
        res.status(500).json({ error: 'Erreur lors de la génération', details: error.message });
    }
});

// ── Route de suivi de statut ──────────────────────────────────────────────
app.get('/check-status/:jobId', async (req, res) => {
    const { jobId } = req.params;

    try {
        console.log(`🔍 Statut du Job ID: ${jobId}`);
        const auth        = { username: RUNSCRIPT_KEY, password: RUNSCRIPT_SECRET };
        const jobResponse = await axios.get(
            `https://runscript.typefi.com/api/v2/job/${jobId}`,
            { auth }
        );
        const rsStatus = jobResponse.data.status;

        if (rsStatus === 'complete') {
            // Chercher la clé S3 : d'abord dans notre état local, sinon extraire du href
            const stored = jobStatus[jobId];
            const s3Key  = stored?.s3Key
                || jobResponse.data.outputs?.[0]?.href?.split('?')[0]?.split('.com/')?.[1];

            if (!s3Key) {
                return res.json({ status: 'failed', message: 'Clé S3 introuvable.' });
            }

            // Vérifier si le fichier est effectivement dans S3 (pour les deux architectures)
            try {
                await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
                // Fichier présent → générer l'URL de téléchargement
                console.log(`✅ Job ${jobId} : PDF disponible dans S3 (${s3Key})`);
                const downloadUrl = await generateS3DownloadUrl(s3Key);
                return res.json({ status: 'done', downloadUrl });
            } catch (headErr) {
                // Fichier pas encore dans S3 — peut-être que RunScript uploade encore
                console.log(`⏳ Job ${jobId} complete mais PDF pas encore dans S3...`);
                return res.json({ status: 'in-progress' });
            }

        } else if (rsStatus === 'failed') {
            console.error(`❌ Job ${jobId} a échoué.`);
            return res.json({ status: 'failed', message: 'La génération du certificat a échoué.' });
        } else {
            return res.json({ status: 'in-progress' });
        }

    } catch (error) {
        console.error(`❌ Erreur /check-status/${jobId} :`, error.message);
        res.status(500).json({ error: 'Erreur de vérification du statut', details: error.message });
    }
});


// ── Diagnostic : réponse complète de l'API RunScript ─────────────────────
app.get('/job-debug/:jobId', async (req, res) => {
    const { jobId } = req.params;
    try {
        const auth     = { username: RUNSCRIPT_KEY, password: RUNSCRIPT_SECRET };
        const response = await axios.get(
            `https://runscript.typefi.com/api/v2/job/${jobId}`,
            { auth }
        );
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message, details: error.response?.data });
    }
});


// ── Test décisif : RunScript peut-il uploader vers une URL externe ? ───────
// Soumet un job RunScript SYNCHRONE avec :
//   - le .indd comme input (RunScript semble requérir au moins un input)
//   - un simple fichier texte comme output
//   - la presigned PUT URL S3 comme destination
// Retourne la réponse COMPLÈTE (inclut le champ "log" avec les erreurs)
// Vérifier ensuite dans S3 si le fichier test/ est apparu.
app.get('/test-runscript-output', async (req, res) => {
    try {
        const testKey  = `test/${Date.now()}_runscript_output.txt`;
        const uploadUrl = await generateS3UploadUrl(testKey);
        const inddUrl   = await generateS3AssetUrl('Commendation-mountains.indd');
        const auth      = { username: RUNSCRIPT_KEY, password: RUNSCRIPT_SECRET };

        // Script ASCII pur. IMPORTANT : #target indesign ne peut pas etre en
        // ligne 1 (cause "Syntax error" dans RunScript) — doit etre precede
        // d'au moins un commentaire, comme dans certificat.jsx.
        const testScript = [
            '// test-runscript-output : verifie upload output RunScript vers S3',
            '// ASCII pur, #target apres commentaire',
            '#target indesign',
            'app.consoleout("Test output RunScript S3 start");',
            'var inddFile = File("Commendation-mountains.indd");',
            'app.consoleout("INDD existe : " + inddFile.exists);',
            'var f = new File("output.txt");',
            'f.open("w");',
            'f.write("RunScript output test at " + new Date().getTime());',
            'f.close();',
            'app.consoleout("Fichier : " + f.fsName);',
            'app.consoleout("Existe  : " + f.exists);',
            'if (!f.exists) { throw new Error("Fichier output.txt non cree"); }',
            'app.consoleout("Test output RunScript S3 OK");',
        ].join('\n');

        const jobData = {
            inputs:  [{ href: inddUrl, path: 'Commendation-mountains.indd' }],
            outputs: [{ path: 'output.txt', href: uploadUrl }],
            script:  testScript,
        };

        // Mode ASYNC (comme les vrais jobs InDesign) + polling jusqu'à completion
        // Le mode synchrone utilise un moteur JS pur (pas InDesign), donc inutilisable
        // pour tester les APIs ExtendScript (app.consoleout, File, etc.)
        console.log('🧪 Test RunScript output (async + polling)...');
        const submitResp = await axios.post(
            'https://runscript.typefi.com/api/v2/job?async=true',
            jobData,
            { auth, timeout: 30000 }
        );
        const testJobId = submitResp.data._id;
        console.log(`🧪 Job soumis : ${testJobId}`);

        // Attendre jusqu'à 90 secondes que le job se termine
        let fullResult = null;
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 3000));
            const poll = await axios.get(
                `https://runscript.typefi.com/api/v2/job/${testJobId}`,
                { auth }
            );
            const st = poll.data.status;
            console.log(`🧪 Poll ${i + 1}/30 : status=${st}`);
            if (st === 'complete' || st === 'failed') {
                fullResult = poll.data;
                break;
            }
        }

        console.log(`🧪 Test terminé — result: ${fullResult?.result}, log: ${fullResult?.log}`);
        res.json({
            status:     'OK',
            fullResult: fullResult || { error: 'timeout apres 90s' },
            s3Key:      testKey,
            s3Bucket:   S3_BUCKET,
            note:       'Si result=success : verifiez si ' + testKey + ' est apparu dans S3',
        });
    } catch (error) {
        res.status(500).json({ error: error.message, details: error.response?.data });
    }
});


// ── Test S3 upload direct depuis Node.js ──────────────────────────────────
app.get('/test-upload', async (req, res) => {
    try {
        const testKey     = `test/${Date.now()}_diagnostic.txt`;
        const uploadUrl   = await generateS3UploadUrl(testKey);
        const testContent = Buffer.from(`Test upload Node.js — ${new Date().toISOString()}`);
        const uploadResp  = await axios.put(uploadUrl, testContent);
        res.json({
            status:   'OK',
            message:  `Upload réussi (HTTP ${uploadResp.status})`,
            key:      testKey,
            bucket:   S3_BUCKET,
        });
    } catch (error) {
        res.status(500).json({
            status:     'ERROR',
            error:      error.message,
            httpStatus: error.response?.status,
            s3Response: error.response?.data,
        });
    }
});


// ── Test RunScript synchrone (vérification de connexion + log) ────────────
app.get('/test', async (req, res) => {
    try {
        if (!RUNSCRIPT_KEY || !RUNSCRIPT_SECRET) {
            return res.status(500).json({ status: 'ERROR', message: 'Clés API RunScript manquantes.' });
        }
        const auth     = { username: RUNSCRIPT_KEY, password: RUNSCRIPT_SECRET };
        const testData = {
            inputs:  [],
            outputs: [],
            script:  "app.consoleout('=== TEST app.consoleout ==='); app.consoleout('OK');",
        };
        const response = await axios.post(
            'https://runscript.typefi.com/api/v2/job',
            testData,
            { auth }
        );
        res.json({ status: 'OK', rawResponse: response.data });
    } catch (error) {
        res.status(500).json({ status: 'ERROR', details: error.message });
    }
});

// ── Démarrage du serveur ──────────────────────────────────────────────────
app.listen(port, () => {
    console.log('');
    console.log('🚀 Serveur RunScript démarré !');
    console.log('================================');
    console.log(`Port     : ${port}`);
    console.log(`APP_URL  : ${APP_URL || '(non défini — presigned URL S3 utilisée)'}`);
    console.log('================================');
});
