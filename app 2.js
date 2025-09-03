const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// ===== CONFIGURATION À MODIFIER =====
const INFOMANIAK_BASE_URL = 'https://votre-domaine.ch/certificats'; // CHANGEZ ICI
const RUNSCRIPT_KEY = 'VOTRE_CLE_API_RUNSCRIPT'; // CHANGEZ ICI
const RUNSCRIPT_SECRET = 'VOTRE_SECRET_RUNSCRIPT'; // CHANGEZ ICI
// =====================================

const app = express();
const port = 3000;

app.use(express.static('.'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Route principale
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/app.html');
});

// Route de génération
app.post('/generate', async (req, res) => {
    try {
        console.log('📝 Nouvelle demande de certificat pour:', req.body.name);
        
        const name = req.body.name;
        const jobId = uuidv4();
        
        // Lire le script JSX
        const script = fs.readFileSync(__dirname + '/eotm.jsx', 'utf8');
        
        // Fichiers d'entrée (hébergés sur Infomaniak)
        const inputs = [
            {
                href: INFOMANIAK_BASE_URL + '/eotm.indd',
                path: 'eotm.indd'
            },
            {
                href: INFOMANIAK_BASE_URL + '/eotm.pdf',
                path: 'eotm.pdf'
            },
            {
                href: INFOMANIAK_BASE_URL + '/Brush Script MT Italic.ttf',
                path: 'Document Fonts/Brush Script MT Italic.ttf'
            }
        ];
        
        // Fichier de sortie temporaire
        const outputFileName = 'certificate_' + jobId + '.pdf';
        const outputs = [
            {
                href: INFOMANIAK_BASE_URL + '/output/' + outputFileName,
                path: 'certificate.pdf',
                method: 'PUT'
            }
        ];
        
        // Données de l