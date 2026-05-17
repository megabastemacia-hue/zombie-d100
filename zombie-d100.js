const SOUND_CRIT_SUCCESS = "https://assets.forge-vtt.com/629920bcbd59cfed65256382/moodmode-weather-news-logo-154226.mp3";
const SOUND_CRIT_FAIL = "https://assets.forge-vtt.com/629920bcbd59cfed65256382/Cod%20zombies%20%20evil%20laugh.mp3";

const VOLUME_CRIT_SUCCESS = 0.1;
const VOLUME_CRIT_FAIL = 0.3;

async function playSoundSafe(path, volume = 0.1) {
  try {
    await AudioHelper.play({ src: path, volume, autoplay: true, loop: false }, true);
  } catch (err) {
    console.error("Erreur son critique :", err);
  }
}

Hooks.once("init", async function () {
  console.log("Zombie Apocalypse D100 | Initialisation");

  Handlebars.registerHelper("eq", (a, b) => a === b);

  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("zombie-d100", ZombieD100ActorSheet, {
    types: ["survivant", "zombie"],
    makeDefault: true
  });

  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("zombie-d100", ZombieD100ItemSheet, {
    types: ["arme", "munition", "nourriture", "soin", "objet", "equipement", "statut"],
    makeDefault: true
  });
});

function isMeleeWeapon(item) {
  const typeArme = String(item?.system?.typeArme ?? "").toLowerCase().trim();
  return typeArme === "melee" || typeArme.includes("corps") || typeArme.includes("cac");
}

class ZombieD100ActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["zombie-d100", "sheet", "actor"],
      template: "systems/zombie-d100/templates/actor-sheet.html",
      width: 900,
      height: 950,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "profil" }]
    });
  }

  getData() {
    const context = super.getData();
    const system = foundry.utils.deepClone(this.actor.system);

    const statusItemsRaw = this.actor.items.filter(i => i.type === "statut");
    const equipmentItemsRaw = this.actor.items.filter(i => i.type === "equipement" && i.system.equipped === true);

    if (system.stats) {
      for (const item of [...statusItemsRaw, ...equipmentItemsRaw]) {
        system.stats.for += Number(item.system.modFor || 0);
        system.stats.agi += Number(item.system.modAgi || 0);
        system.stats.int += Number(item.system.modInt || 0);
        system.stats.per += Number(item.system.modPer || 0);
        system.stats.str += Number(item.system.modStr || 0);
        system.stats.combat += Number(item.system.modCombat || 0);
        system.stats.tir += Number(item.system.modTir || 0);
      }
    }

    context.system = system;
    context.isZombie = this.actor.type === "zombie";

    const allItems = this.actor.items.map(item => {
      const modes = String(item.system.modesAutorises ?? "").split(",").map(m => m.trim());

      return {
        id: item.id,
        name: item.name,
        type: item.type,
        system: item.system,
        isWeapon: item.type === "arme",
        isAmmo: item.type === "munition",
        isUsable: ["nourriture", "soin", "objet"].includes(item.type),
        isEquipment: item.type === "equipement",
        isEquipped: item.system.equipped === true,
        isStatus: item.type === "statut",
        slot: item.system.slot || "",
        canSemi: modes.includes("semi"),
        canBurst: modes.includes("burst"),
        canAuto: modes.includes("auto")
      };
    });

    context.statusItems = allItems.filter(i => i.type === "statut");
    context.equipmentItems = allItems.filter(i => i.type === "equipement");
    context.inventoryItems = allItems.filter(i => i.type !== "statut" && i.type !== "equipement");

    context.equippedSlots = {
      head: allItems.find(i => i.type === "equipement" && i.system.equipped && i.system.slot === "head"),
      body: allItems.find(i => i.type === "equipement" && i.system.equipped && i.system.slot === "body"),
      bag: allItems.find(i => i.type === "equipement" && i.system.equipped && i.system.slot === "bag"),
      primary: allItems.find(i => (i.type === "equipement" || i.type === "arme") && i.system.equipped && i.system.slot === "primary"),
      secondary: allItems.find(i => (i.type === "equipement" || i.type === "arme") && i.system.equipped && i.system.slot === "secondary"),
      hands: allItems.find(i => i.type === "equipement" && i.system.equipped && i.system.slot === "hands"),
      feet: allItems.find(i => i.type === "equipement" && i.system.equipped && i.system.slot === "feet"),
      accessory: allItems.find(i => i.type === "equipement" && i.system.equipped && i.system.slot === "accessory")
    };

    return context;
  }

  async _onDrop(event) {
    event.preventDefault();

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return super._onDrop(event);
    }

    if (data.type !== "Item") return super._onDrop(event);

    let droppedItem = null;
    try {
      if (data.uuid) droppedItem = await fromUuid(data.uuid);
      if (!droppedItem && data.id) droppedItem = game.items.get(data.id);
    } catch (err) {
      console.error(err);
    }

    if (!droppedItem) return ui.notifications.warn("Objet introuvable.");

    const itemData = droppedItem.toObject();
    const stackableTypes = ["munition", "nourriture", "soin", "objet"];

    if (stackableTypes.includes(itemData.type)) {
      const existing = this.actor.items.find(i => i.type === itemData.type && i.name === itemData.name);
      if (existing) {
        const oldQty = Number(existing.system.quantite ?? 1);
        const addQty = Number(itemData.system?.quantite ?? 1);
        await existing.update({ "system.quantite": oldQty + addQty });
        return ui.notifications.info(`${itemData.name} cumulé : ${oldQty + addQty}`);
      }
    }

    await this.actor.createEmbeddedDocuments("Item", [itemData]);
    ui.notifications.info(`${itemData.name} ajouté à ${this.actor.name}.`);
  }

  _getStatusModifier(stat) {
    let total = 0;

    for (const item of this.actor.items) {
      const activeStatus = item.type === "statut";
      const activeEquipment = item.type === "equipement" && item.system.equipped === true;
      if (!activeStatus && !activeEquipment) continue;

      if (stat === "for") total += Number(item.system.modFor ?? 0);
      if (stat === "agi") total += Number(item.system.modAgi ?? 0);
      if (stat === "int") total += Number(item.system.modInt ?? 0);
      if (stat === "per") total += Number(item.system.modPer ?? 0);
      if (stat === "str") total += Number(item.system.modStr ?? 0);
      if (stat === "combat") total += Number(item.system.modCombat ?? 0);
      if (stat === "tir") total += Number(item.system.modTir ?? 0);
    }

    return total;
  }

  _getStatusList() {
    const statuses = this.actor.items.filter(i => i.type === "statut");
    return statuses.length ? statuses.map(s => s.name).join(", ") : "";
  }

  async _rollD100(label, value, bonus = 0, arme = "", statKey = null, extraInfo = "") {
    const statusMod = statKey ? this._getStatusModifier(statKey) : 0;
    const finalBonus = Number(bonus) + Number(statusMod);
    const seuil = Math.max(1, Math.min(100, Number(value) + finalBonus));

    const roll = await new Roll("1d100").evaluate({ async: true });
    const result = roll.total;

    let outcome = "ÉCHEC";
    let color = "#ff9900";

    if (result <= 5) {
      outcome = "RÉUSSITE CRITIQUE";
      color = "#00ff66";
      await playSoundSafe(SOUND_CRIT_SUCCESS, VOLUME_CRIT_SUCCESS);
    } else if (result >= 96) {
      outcome = "ÉCHEC CRITIQUE";
      color = "#ff0000";
      await playSoundSafe(SOUND_CRIT_FAIL, VOLUME_CRIT_FAIL);
    } else if (result <= seuil) {
      outcome = "RÉUSSITE";
      color = "#33cc33";
    }

    const statusList = this._getStatusList();

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `
        <div class="zombie-chat-card">
          <h2>☣ RAPPORT DE SURVIE ☣</h2>
          <p><b>Survivant :</b> ${this.actor.name}</p>
          ${arme ? `<p><b>Arme :</b> ${arme}</p>` : ""}
          <p><b>Test :</b> ${label}</p>
          <p><b>Seuil final :</b> ${seuil}%</p>
          <p><b>Bonus/Malus total :</b> ${finalBonus}</p>
          ${statusMod !== 0 ? `<p class="danger"><b>Modificateurs actifs :</b> ${statusMod}</p>` : ""}
          ${statusList ? `<p><b>Statuts actifs :</b> ${statusList}</p>` : ""}
          ${extraInfo ? `<hr>${extraInfo}` : ""}
          <p><b>Résultat :</b> ${result}</p>
          <hr>
          <h2 style="color:${color};">${outcome}</h2>
          ${result >= 96 ? `<p class="danger">Incident possible : arme enrayée, chute, panique ou danger immédiat.</p>` : ""}
        </div>
      `
    });
  }

  async _equipWeapon(item, slot) {
    if (!item || item.type !== "arme") return;

    const currentlyEquipped = this.actor.items.filter(i =>
      i.type === "arme" &&
      i.system.slot === slot &&
      i.system.equipped === true &&
      i.id !== item.id
    );

    for (const other of currentlyEquipped) {
      await other.update({ "system.equipped": false, "system.slot": "" });
    }

    await item.update({ "system.equipped": true, "system.slot": slot });
    ui.notifications.info(`${item.name} équipé en ${slot === "primary" ? "main principale" : "main secondaire"}.`);
  }

  async _equipItem(item) {
    if (!item || item.type !== "equipement") return;

    const slot = item.system.slot || "body";

    const currentlyEquipped = this.actor.items.filter(i =>
      i.type === "equipement" &&
      i.system.slot === slot &&
      i.system.equipped === true &&
      i.id !== item.id
    );

    for (const other of currentlyEquipped) {
      await other.update({ "system.equipped": false });
    }

    await item.update({ "system.equipped": true });
    ui.notifications.info(`${item.name} équipé dans le slot ${slot}.`);
  }

  async _unequipItem(item) {
    if (!item) return;

    if (item.type === "arme") {
      await item.update({ "system.equipped": false, "system.slot": "" });
      return ui.notifications.info(`${item.name} retiré.`);
    }

    if (item.type === "equipement") {
      await item.update({ "system.equipped": false });
      ui.notifications.info(`${item.name} retiré.`);
    }
  }

  async _findStatusInCompendium(name) {
    const pack = game.packs.get("world.statuts");
    if (!pack) {
      ui.notifications.warn("Compendium world.statuts introuvable.");
      return null;
    }

    await pack.getIndex();
    const entry = pack.index.find(e => e.name === name);
    if (!entry) {
      console.warn(`Statut introuvable dans world.statuts : ${name}`);
      return null;
    }

    return await pack.getDocument(entry._id);
  }

  async _addStatus(name) {
    const existing = this.actor.items.find(i => i.type === "statut" && i.name === name);
    if (existing) return;

    const statusDoc = await this._findStatusInCompendium(name);
    if (!statusDoc) return;

    await this.actor.createEmbeddedDocuments("Item", [statusDoc.toObject()]);
    ui.notifications.info(`${this.actor.name} gagne le statut : ${name}`);
  }

  async _removeStatus(name) {
    const existing = this.actor.items.find(i => i.type === "statut" && i.name === name);
    if (!existing) return;

    await this.actor.deleteEmbeddedDocuments("Item", [existing.id]);
    ui.notifications.info(`${this.actor.name} perd le statut : ${name}`);
  }

  async _updateAutomaticStatuses() {
    const stress = Number(this.actor.system.stress?.value ?? 0);
    const faim = Number(this.actor.system.survie?.faim ?? 0);
    const soif = Number(this.actor.system.survie?.soif ?? 0);
    const infectionStage = Number(this.actor.system.infection?.stage ?? 0);

    if (stress >= 50) await this._addStatus("😰 Stressé");
    else await this._removeStatus("😰 Stressé");

    if (stress >= 75) await this._addStatus("😱 Panique");
    else await this._removeStatus("😱 Panique");

    if (stress >= 90) await this._addStatus("🤯 Hallucinations");
    else await this._removeStatus("🤯 Hallucinations");

    if (faim >= 80) await this._addStatus("💞 Affamé");
    else await this._removeStatus("💞 Affamé");

    if (soif >= 80) await this._addStatus("💧 Déshydraté");
    else await this._removeStatus("💧 Déshydraté");

    if (infectionStage >= 2) await this._addStatus("☣️ Fièvre infectieuse");
    else await this._removeStatus("☣️ Fièvre infectieuse");
  }

  async _checkMentalState() {
    const stress = Number(this.actor.system.stress?.value ?? 0);

    let state = "stable";
    let message = "Le survivant garde son calme.";

    if (stress >= 25) {
      state = "anxieux";
      message = "Le survivant devient nerveux, tendu, et surveille chaque bruit.";
    }

    if (stress >= 50) {
      state = "stressé";
      message = "Le survivant est sous pression et commence à perdre en efficacité.";
    }

    if (stress >= 75) {
      state = "panique";
      message = "Le survivant tremble, respire mal et perd sa concentration.";
    }

    if (stress >= 90) {
      state = "hallucinations";
      message = "Le survivant commence à voir ou entendre des choses inexistantes.";
    }

    await this.actor.update({ "system.stress.mentalState": state });
    await this._updateAutomaticStatuses();

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `
        <div class="zombie-chat-card">
          <h2>🧠 ÉTAT MENTAL</h2>
          <p><b>${this.actor.name}</b></p>
          <p><b>Stress :</b> ${stress}/100</p>
          <p><b>État :</b> ${state}</p>
          <p>${message}</p>
        </div>
      `
    });
  }

  async _progressInfection() {
    if (!this.actor.system.infection?.infected) {
      ui.notifications.warn("Le personnage n'est pas infecté.");
      return;
    }

    const stage = Number(this.actor.system.infection.stage ?? 0) + 1;

    await this.actor.update({ "system.infection.stage": stage });
    await this._updateAutomaticStatuses();

    let message = "Fièvre légère et fatigue.";
    if (stage === 2) message = "Tremblements et hallucinations.";
    if (stage === 3) message = "Perte de contrôle progressive.";
    if (stage >= 4) message = "Transformation imminente.";

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `
        <div class="zombie-chat-card">
          <h2>☣ PROGRESSION DE L'INFECTION ☣</h2>
          <p><b>${this.actor.name}</b> atteint le stade <b>${stage}</b>.</p>
          <p>${message}</p>
        </div>
      `
    });
  }

  async _zombieAttack() {
    const combat = Number(this.actor.system.stats?.combat ?? 10);
    const aggressivite = Number(this.actor.system.zombie?.aggressivite ?? 0);
    const seuil = Math.max(1, Math.min(100, combat + aggressivite));

    const roll = await new Roll("1d100").evaluate({ async: true });
    const result = roll.total;

    let outcome = "ATTAQUE RATÉE";
    let color = "#ff9900";
    let consequence = "Le zombie manque sa cible.";

    if (result <= 5) {
      outcome = "MORSURE CRITIQUE";
      color = "#ff0000";
      consequence = "Morsure grave. Le MJ peut imposer infection, blessure critique ou panique.";
      await playSoundSafe(SOUND_CRIT_FAIL, VOLUME_CRIT_FAIL);
    } else if (result >= 96) {
      outcome = "ÉCHEC CRITIQUE";
      color = "#999999";
      consequence = "Le zombie tombe, se bloque, ou laisse une ouverture.";
      await playSoundSafe(SOUND_CRIT_SUCCESS, VOLUME_CRIT_SUCCESS);
    } else if (result <= seuil) {
      outcome = "ATTAQUE RÉUSSIE";
      color = "#ff3333";
      consequence = "Griffure, morsure légère, plaquage ou blessure narrative selon la scène.";
    }

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `
        <div class="zombie-chat-card">
          <h2>🧟 ATTAQUE ZOMBIE 🧟</h2>
          <p><b>Zombie :</b> ${this.actor.name}</p>
          <p><b>Type :</b> ${this.actor.system.zombie?.type ?? "zombie"}</p>
          <p><b>Seuil d'attaque :</b> ${seuil}%</p>
          <p><b>Jet :</b> ${result}</p>
          <hr>
          <h2 style="color:${color};">${outcome}</h2>
          <p>${consequence}</p>
        </div>
      `
    });
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".equip-weapon").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);
      if (!item || item.type !== "arme") return;

      new Dialog({
        title: "Équiper l'arme",
        content: `<p>Où veux-tu équiper <b>${item.name}</b> ?</p>`,
        buttons: {
          primary: {
            label: "Main principale",
            callback: async () => this._equipWeapon(item, "primary")
          },
          secondary: {
            label: "Main secondaire",
            callback: async () => this._equipWeapon(item, "secondary")
          }
        },
        default: "primary"
      }).render(true);
    });

    html.find(".fire-mode").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);
      if (!item || item.type !== "arme") return;

      if (isMeleeWeapon(item)) {
        ui.notifications.warn("Une arme de corps à corps n'a pas de mode de tir.");
        return;
      }

      const mode = ev.currentTarget.dataset.mode;
      const modesAutorises = String(item.system.modesAutorises ?? "semi").split(",").map(m => m.trim());

      if (!modesAutorises.includes(mode)) {
        ui.notifications.warn(`${item.name} ne peut pas utiliser ce mode.`);
        return;
      }

      await item.update({ "system.modeTirActuel": mode });
      ui.notifications.info(`${item.name} passe en mode ${mode}.`);
    });

    html.find(".item-open").click(ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row, .equipment-slot");
      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);
      if (item) item.sheet.render(true);
    });

    html.find(".item-delete").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row, .equipment-slot");
      if (!row) return;

      await this.actor.deleteEmbeddedDocuments("Item", [row.dataset.itemId]);
    });

    html.find(".equip-item").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);
      await this._equipItem(item);
    });

    html.find(".unequip-item").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row, .equipment-slot");
      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);
      await this._unequipItem(item);
    });

    html.find(".item-use").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);
      if (!item || ["arme", "statut", "munition", "equipement"].includes(item.type)) return;

      const quantite = Number(item.system.quantite ?? 1);
      const stressMod = Number(item.system.stressMod ?? 0);
      const faimMod = Number(item.system.faimMod ?? 0);
      const soifMod = Number(item.system.soifMod ?? 0);
      const noteUse = item.system.noteUse || "";
      const updates = {};

      if (stressMod !== 0) {
        const current = Number(this.actor.system.stress?.value ?? 0);
        updates["system.stress.value"] = Math.max(0, Math.min(100, current + stressMod));
      }

      if (faimMod !== 0) {
        const current = Number(this.actor.system.survie?.faim ?? 0);
        updates["system.survie.faim"] = Math.max(0, Math.min(100, current + faimMod));
      }

      if (soifMod !== 0) {
        const current = Number(this.actor.system.survie?.soif ?? 0);
        updates["system.survie.soif"] = Math.max(0, Math.min(100, current + soifMod));
      }

      if (Object.keys(updates).length > 0) await this.actor.update(updates);

      if (quantite > 1) await item.update({ "system.quantite": quantite - 1 });
      else await this.actor.deleteEmbeddedDocuments("Item", [item.id]);

      await this._updateAutomaticStatuses();

      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: `
          <div class="zombie-chat-card">
            <h2>☣ OBJET UTILISÉ ☣</h2>
            <p><b>${this.actor.name}</b> utilise <b>${item.name}</b>.</p>
            ${stressMod !== 0 ? `<p>Stress : ${stressMod}</p>` : ""}
            ${faimMod !== 0 ? `<p>Faim : ${faimMod}</p>` : ""}
            ${soifMod !== 0 ? `<p>Soif : ${soifMod}</p>` : ""}
            ${noteUse ? `<p>${noteUse}</p>` : ""}
          </div>
        `
      });
    });

    html.find(".item-attack").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);
      if (!item || item.type !== "arme") return;

      const melee = isMeleeWeapon(item);

      let modeTir = "melee";
      let coutMunition = 0;
      let bonusMode = 0;
      let modeLabel = "Corps à corps";

      if (!melee) {
        modeTir = item.system.modeTirActuel || "semi";

        const modesAutorises = String(item.system.modesAutorises ?? "semi")
          .split(",")
          .map(m => m.trim())
          .filter(m => m.length > 0);

        if (!modesAutorises.includes(modeTir)) {
          ui.notifications.warn(`${item.name} ne peut pas utiliser le mode ${modeTir}.`);
          return;
        }

        if (modeTir === "semi") {
          coutMunition = 1;
          bonusMode = 0;
          modeLabel = "Semi-auto";
        }

        if (modeTir === "burst") {
          coutMunition = 3;
          bonusMode = 10;
          modeLabel = "Rafale";
        }

        if (modeTir === "auto") {
          coutMunition = 5;
          bonusMode = 20;
          modeLabel = "Automatique";
        }
      }

      const bonus = Number(item.system.bonus ?? 0) + bonusMode;
      const statKey = melee ? "combat" : "tir";
      const statLabel = melee ? "Combat rapproché" : `Tir - ${modeLabel}`;
      const baseValue = Number(this.actor.system.stats?.[statKey] ?? 10);

      let ammoBefore = Number(item.system.munitions ?? 0);
      let ammoAfter = ammoBefore;

      if (!melee) {
        if (ammoBefore < coutMunition) {
          ui.notifications.warn(`${item.name} n'a pas assez de munitions dans le chargeur !`);
          return;
        }

        ammoAfter = ammoBefore - coutMunition;
        await item.update({ "system.munitions": ammoAfter });
      }

      const extraInfo = `
        <p><b>Mode utilisé :</b> ${modeLabel}</p>
        ${!melee ? `<p><b>Munitions consommées :</b> ${coutMunition}</p>` : ""}
        ${!melee ? `<p><b>Munitions restantes :</b> ${ammoAfter}</p>` : ""}
      `;

      await this._rollD100(statLabel, baseValue, bonus, item.name, statKey, extraInfo);
    });

    html.find(".item-reload").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      const weapon = this.actor.items.get(row.dataset.itemId);
      if (!weapon || weapon.type !== "arme") return;

      if (isMeleeWeapon(weapon)) {
        ui.notifications.warn("Une arme de corps à corps ne se recharge pas.");
        return;
      }

      const typeMunition = weapon.system.typeMunition;
      if (!typeMunition) return ui.notifications.warn("Cette arme n'utilise pas de munition.");

      const ammoItem = this.actor.items.find(i => i.type === "munition" && i.name === typeMunition);
      if (!ammoItem) return ui.notifications.warn(`Aucune munition ${typeMunition} trouvée.`);

      const chargeurMax = Number(weapon.system.chargeur ?? 0);
      const currentAmmo = Number(weapon.system.munitions ?? 0);
      const missing = chargeurMax - currentAmmo;

      if (missing <= 0) return ui.notifications.info("Chargeur déjà plein.");

      const reserve = Number(ammoItem.system.quantite ?? 0);
      if (reserve <= 0) return ui.notifications.warn("Plus de munitions disponibles.");

      const used = Math.min(missing, reserve);

      await weapon.update({ "system.munitions": currentAmmo + used });
      await ammoItem.update({ "system.quantite": reserve - used });
    });

    html.find(".roll-stat").click(async ev => {
      ev.preventDefault();

      const stat = ev.currentTarget.dataset.stat;
      const label = ev.currentTarget.dataset.label;
      const value = Number(this.actor.system.stats?.[stat] ?? 10);

      await this._rollD100(label, value, 0, "", stat);
    });

    html.find(".stress-plus").click(async ev => {
      ev.preventDefault();

      const current = Number(this.actor.system.stress?.value ?? 0);
      await this.actor.update({ "system.stress.value": Math.min(100, current + 5) });
      await this._updateAutomaticStatuses();
    });

    html.find(".stress-minus").click(async ev => {
      ev.preventDefault();

      const current = Number(this.actor.system.stress?.value ?? 0);
      await this.actor.update({ "system.stress.value": Math.max(0, current - 5) });
      await this._updateAutomaticStatuses();
    });

    html.find('input[name="system.survie.faim"], input[name="system.survie.soif"]').change(async ev => {
      ev.preventDefault();
      await this.submit({preventClose: true,updateData: {}});
      await this._updateAutomaticStatuses();
      this.render(false);
    });

    html.find(".mental-check").click(async ev => {
      ev.preventDefault();
      await this._checkMentalState();
    });

    html.find(".infection-progress").click(async ev => {
      ev.preventDefault();
      await this._progressInfection();
    });

    html.find(".zombie-attack").click(async ev => {
      ev.preventDefault();
      await this._zombieAttack();
    });
  }
}

class ZombieD100ItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["zombie-d100", "sheet", "item"],
      template: "systems/zombie-d100/templates/item-sheet.html",
      width: 560,
      height: 760
    });
  }

  getData() {
    const context = super.getData();

    context.system = this.item.system;
    context.isWeapon = this.item.type === "arme";
    context.isAmmo = this.item.type === "munition";
    context.isStatus = this.item.type === "statut";
    context.isEquipment = this.item.type === "equipement";
    context.isUsable = ["nourriture", "soin", "objet"].includes(this.item.type);

    return context;
  }
}
