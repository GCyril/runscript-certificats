// certificat.jsx — Script InDesign pour générer le certificat (2 champs)
// Champs : <<Nom>> et <<Date>>
// NOTE : pas de directive #target ici — le script tourne déjà dans InDesign Server
// via l'API RunScript. #target indesign provoque un conflit (recommandation Typefi).

// ── Récupération des arguments ──────────────────────────────────────────────
var recipientName = "";
var certDate      = "";

if (app.scriptArgs.isDefined("Nom")) {
    recipientName = app.scriptArgs.getValue("Nom");
}
if (app.scriptArgs.isDefined("Date")) {
    certDate = app.scriptArgs.getValue("Date");
}

// Le champ Nom est affiché en majuscules dans le certificat.
// On force toUpperCase() ici plutôt que de dépendre du style InDesign
// (le changeGrep peut ne pas hériter du All Caps du placeholder).
recipientName = recipientName.toUpperCase();

app.consoleout("=== Démarrage certificat.jsx ===");
app.consoleout("Nom  : " + recipientName);
app.consoleout("Date : " + certDate);
app.consoleout("InDesign version : " + app.version);

// ── Mode serveur : supprimer TOUS les dialogues InDesign ──────────────────
// UserInteractionLevels n'est pas défini dans tous les contextes RunScript.
// InDesign Server est headless par défaut → ce bloc est optionnel.
// Le try/catch évite un crash si l'énumération n'est pas disponible.
try {
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    app.consoleout("Mode NEVER_INTERACT activé");
} catch (uiErr) {
    app.consoleout("UserInteractionLevels non disponible (ignoré) : " + uiErr.toString());
}

try {
    // ── Ouverture du document IDML ─────────────────────────────────────────
    // IDML (InDesign Markup Language) est un format XML indépendant de la version.
    // Contrairement au .indd, un fichier IDML créé dans InDesign 2025 peut être
    // ouvert par n'importe quelle version antérieure d'InDesign Server.
    // RunScript utilise InDesign 2024 (v20.x) — le .indd v21 était incompatible.
    var idmlFile = File("Commendation-mountains.idml");
    app.consoleout("Chemin IDML    : " + idmlFile.fsName);
    app.consoleout("Fichier existe : " + idmlFile.exists);

    if (!idmlFile.exists) {
        throw new Error("IDML introuvable : " + idmlFile.fsName);
    }

    var doc = app.open(idmlFile);
    app.consoleout("Document ouvert : " + doc.name);

    // ── Dossier de travail ────────────────────────────────────────────────
    // Avec IDML, le document ouvert est "Untitled" (pas encore enregistré),
    // donc doc.fullName n'est pas fiable. On utilise idmlFile.parent qui pointe
    // directement vers le dossier où RunScript a téléchargé tous les inputs.
    var docFolder = idmlFile.parent;
    app.consoleout("Dossier de travail : " + docFolder.fsName);
    app.consoleout("Nombre de liens    : " + doc.links.length);

    // ── Relink de tous les assets depuis le dossier de travail RunScript ──
    // RunScript place l'IDML et tous les assets dans le même dossier.
    // InDesign cherche d'abord au chemin d'origine (Mac local) → introuvable.
    // On force le relink vers le dossier de l'IDML sur le serveur.
    for (var i = 0; i < doc.links.length; i++) {
        var lien = doc.links[i];
        var linkedFile = new File(docFolder.fsName + "/" + lien.name);
        app.consoleout("Lien [" + i + "] : " + lien.name
            + " | status=" + lien.status
            + " | fichier local existe=" + linkedFile.exists);
        if (linkedFile.exists) {
            try {
                lien.relink(linkedFile);
                lien.update();
                app.consoleout("  → Relié avec succès");
            } catch (relinkErr) {
                app.consoleout("  → Erreur relink : " + relinkErr.toString());
            }
        } else {
            app.consoleout("  → Fichier introuvable dans le dossier de travail");
        }
    }

    // ── Remplacement de <<Nom>> ────────────────────────────────────────────
    app.findGrepPreferences  = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat   = "<<Nom>>";
    app.changeGrepPreferences.changeTo = recipientName;
    var foundNames = doc.changeGrep();
    app.consoleout("<<Nom>>  : " + foundNames.length + " remplacement(s)");

    // ── Remplacement de <<Date>> ───────────────────────────────────────────
    app.findGrepPreferences  = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat   = "<<Date>>";
    app.changeGrepPreferences.changeTo = certDate;
    var foundDates = doc.changeGrep();
    app.consoleout("<<Date>> : " + foundDates.length + " remplacement(s)");

    // ── Export PDF ────────────────────────────────────────────────────────
    // Chemin absolu dans le dossier de travail (même répertoire que l'IDML).
    var pdfFile = new File(docFolder.fsName + "/certificat.pdf");
    app.consoleout("PDF cible : " + pdfFile.fsName);
    app.consoleout("Nombre de presets PDF : " + app.pdfExportPresets.length);

    // Sur InDesign Server, exportFile requiert un PDFExportPreset explicite.
    // (Contrairement à InDesign Desktop, le paramètre showingOptions/booléen
    //  n'est pas accepté — InDesign Server attend le preset comme 3e argument.)
    // On essaie les presets intégrés dans l'ordre de préférence, puis fallback
    // sur le premier preset disponible.
    var pdfPreset = null;
    var presetCandidates = [
        "[High Quality Print]",
        "[PDF/X-4:2008]",
        "[Press Quality]",
        "[PDF/X-1a:2001]",
        "[Smallest File Size]"
    ];
    for (var p = 0; p < presetCandidates.length; p++) {
        try {
            var candidate = app.pdfExportPresets.item(presetCandidates[p]);
            if (candidate.isValid) {
                pdfPreset = candidate;
                app.consoleout("Preset PDF selectionne : " + presetCandidates[p]);
                break;
            }
        } catch (pErr) {
            app.consoleout("Preset " + presetCandidates[p] + " non dispo : " + pErr.toString());
        }
    }
    // Fallback : premier preset disponible quel qu'il soit
    if (!pdfPreset && app.pdfExportPresets.length > 0) {
        pdfPreset = app.pdfExportPresets[0];
        app.consoleout("Preset PDF fallback (index 0) : " + pdfPreset.name);
    }

    if (pdfPreset) {
        // InDesign Server : exportFile(format, to, using:PDFExportPreset) — 3 args
        // Le preset est en position 3, PAS de showingOptions avant lui
        // (contrairement à InDesign Desktop qui accepte un booléen en 3e position)
        doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, pdfPreset);
    } else {
        // Aucun preset trouvé — erreur explicite plutôt qu'un crash obscur
        throw new Error("Aucun preset PDF disponible sur ce serveur InDesign. "
            + "Presets testes : " + presetCandidates.join(", "));
    }

    app.consoleout("PDF exporté : " + pdfFile.fsName);
    app.consoleout("PDF existe  : " + pdfFile.exists);

    // ── Vérification CRITIQUE : le PDF doit exister ───────────────────────
    if (!pdfFile.exists) {
        throw new Error("EXPORT ECHOUE : " + pdfFile.fsName
            + " n'existe pas apres doc.exportFile()."
            + " Verifiez les polices, l'image liee et la version InDesign.");
    }

    // ── Fermeture sans sauvegarde ─────────────────────────────────────────
    doc.close(SaveOptions.NO);
    app.consoleout("=== Script termine avec succes ===");

} catch (error) {
    app.consoleout("ERREUR : " + error.toString());
    app.consoleout("Ligne  : " + error.line);
    throw error;
}
