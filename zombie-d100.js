Hooks.once("init", async function () {
  console.log("Zombie Apocalypse D100 | Initialisation");

  Handlebars.registerHelper("eq", function (a, b) {
    return a === b;
  });

  Actors.unregisterSheet("core", ActorSheet);

  Actors.registerSheet("zombie-d100", ZombieD100ActorSheet, {
    types: ["survivant", "zombie"],
    makeDefault: true
  });

  Items.unregisterSheet("core", ItemSheet);

  Items.registerSheet("zombie-d100", ZombieD100ItemSheet, {
    types: ["arme", "munition", "nourriture", "soin", "objet", "statut"],
    makeDefault: true
  });
});

class ZombieD100ActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["zombie-d100", "sheet", "actor"],
      template: "systems/zombie-d100/templates/actor-sheet.html",
      width: 900,
      height: 950,
      tabs: [
        {
          navSelector: ".sheet-tabs",
          contentSelector: ".sheet-body",
          initial: "profil"
        }
      ],
      dragDrop: [
        {
          dragSelector: ".item-row",
          dropSelector: ".zombie-sheet"
        }
      ]
    });
  }

  getData() {
    const context = super.getData();

    context.system = this.actor.system;
    context.isZombie = this.actor.type === "zombie";

    const allItems = this.actor.items.map(item => {
      const modes = String(item.system.modesAutorises ?? "")
        .split(",")
        .map(m => m.trim());

      return {
        id: item.id,
        name: item.name,
        type: item.type,
        system: item.system,

        isWeapon: item.type === "arme",
        isAmmo: item.type === "munition",
        isUsable:
          item.type === "nourriture" ||
          item.type === "soin" ||
          item.type === "objet",
        isStatus: item.type === "statut",

        canSemi: modes.includes("semi"),
        canBurst: modes.includes("burst"),
        canAuto: modes.includes("auto")
      };
    });

    context.statusItems = allItems.filter(i => i.type === "statut");
    context.inventoryItems = allItems.filter(i => i.type !== "statut");

    return context;
  }

  async _onDrop(event) {
    event.preventDefault();

    let data;

    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (err) {
      return super._onDrop(event);
    }

    if (data.type !== "Item") {
      return super._onDrop(event);
    }

    let droppedItem = null;

    try {
      if (data.uuid) {
        droppedItem = await fromUuid(data.uuid);
      }

      if (!droppedItem && data.id) {
        droppedItem = game.items.get(data.id);
      }
    } catch (err) {
      console.error(err);
    }

    if (!droppedItem) {
      ui.notifications.warn("Objet introuvable.");
      return;
    }

    const itemData = droppedItem.toObject();

    const stackableTypes = ["munition", "nourriture", "soin", "objet"];

    if (stackableTypes.includes(itemData.type)) {
      const existing = this.actor.items.find(i =>
        i.type === itemData.type &&
        i.name === itemData.name
      );

      if (existing) {
        const oldQty = Number(existing.system.quantite ?? 1);
        const addQty = Number(itemData.system?.quantite ?? 1);

        await existing.update({
          "system.quantite": oldQty + addQty
        });

        ui.notifications.info(`${itemData.name} cumulé : ${oldQty + addQty}`);
        return;
      }
    }

    await this.actor.createEmbeddedDocuments("Item", [itemData]);

    ui.notifications.info(`${itemData.name} ajouté à ${this.actor.name}.`);
  }

  _getStatusModifier(stat) {
    let total = 0;

    for (let item of this.actor.items) {
      if (item.type !== "statut") continue;

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
    } else if (result >= 96) {
      outcome = "ÉCHEC CRITIQUE";
      color = "#ff0000";
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
          ${statusMod !== 0 ? `<p class="danger"><b>Modificateur de statuts :</b> ${statusMod}</p>` : ""}
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
    } else if (result >= 96) {
      outcome = "ÉCHEC CRITIQUE";
      color = "#999999";
      consequence = "Le zombie tombe, se bloque, ou laisse une ouverture.";
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

  async _progressInfection() {
    if (!this.actor.system.infection?.infected) {
      ui.notifications.warn("Le personnage n'est pas infecté.");
      return;
    }

    const stage = Number(this.actor.system.infection.stage ?? 0) + 1;

    await this.actor.update({
      "system.infection.stage": stage
    });

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

  async _checkMentalState() {
    const stress = Number(this.actor.system.stress?.value ?? 0);

    let state = "stable";
    let effect = "Le survivant garde son calme.";

    if (stress >= 90) {
      state = "folie";
      effect = "CRISE MAJEURE : hallucinations violentes, perte de contrôle.";
    } else if (stress >= 75) {
      state = "hallucinations";
      effect = "Le survivant voit ou entend des choses inexistantes.";
    } else if (stress >= 50) {
      state = "panique";
      effect = "Tremblements, respiration difficile, difficultés de concentration.";
    } else if (stress >= 25) {
      state = "anxiete";
      effect = "Le survivant devient nerveux et paranoïaque.";
    }

    await this.actor.update({
      "system.stress.mentalState": state
    });

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `
        <div class="zombie-chat-card">
          <h2>☣ ÉTAT MENTAL ☣</h2>
          <p><b>${this.actor.name}</b> est maintenant en état : <b>${state.toUpperCase()}</b></p>
          <p>${effect}</p>
          <p>Stress actuel : ${stress}/100</p>
        </div>
      `
    });
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".fire-mode").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);
      if (!item || item.type !== "arme") return;

      const mode = ev.currentTarget.dataset.mode;

      const modesAutorises = String(item.system.modesAutorises ?? "semi")
        .split(",")
        .map(m => m.trim());

      if (!modesAutorises.includes(mode)) {
        ui.notifications.warn(`${item.name} ne peut pas utiliser ce mode.`);
        return;
      }

      await item.update({
        "system.modeTirActuel": mode
      });

      ui.notifications.info(`${item.name} passe en mode ${mode}.`);
    });

    html.find(".item-open").click(ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);
      if (item) item.sheet.render(true);
    });

    html.find(".item-delete").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      await this.actor.deleteEmbeddedDocuments("Item", [row.dataset.itemId]);
    });

    html.find(".item-use").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);

      if (!item || item.type === "arme" || item.type === "statut" || item.type === "munition") return;

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

      if (Object.keys(updates).length > 0) {
        await this.actor.update(updates);
      }

      if (quantite > 1) {
        await item.update({
          "system.quantite": quantite - 1
        });
      } else {
        await this.actor.deleteEmbeddedDocuments("Item", [item.id]);
      }

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

      const typeArme = item.system.typeArme || "tir";

      const modesAutorises = String(item.system.modesAutorises ?? "semi")
        .split(",")
        .map(m => m.trim())
        .filter(m => m.length > 0);

      let modeTir = item.system.modeTirActuel || "semi";

      if (typeArme === "melee") {
        modeTir = "melee";
      }

      if (!modesAutorises.includes(modeTir)) {
        ui.notifications.warn(`${item.name} ne peut pas utiliser le mode ${modeTir}.`);
        return;
      }

      let coutMunition = 0;
      let bonusMode = 0;
      let modeLabel = "Corps à corps";

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

      const bonus = Number(item.system.bonus ?? 0) + bonusMode;

      const statKey = typeArme === "melee" ? "combat" : "tir";
      const statLabel = typeArme === "melee" ? "Combat rapproché" : `Tir - ${modeLabel}`;
      const baseValue = Number(this.actor.system.stats?.[statKey] ?? 10);

      let ammoBefore = Number(item.system.munitions ?? 0);
      let ammoAfter = ammoBefore;

      if (typeArme !== "melee") {
        if (ammoBefore < coutMunition) {
          ui.notifications.warn(`${item.name} n'a pas assez de munitions dans le chargeur !`);
          return;
        }

        ammoAfter = ammoBefore - coutMunition;

        await item.update({
          "system.munitions": ammoAfter
        });
      }

      const extraInfo = `
        <p><b>Mode utilisé :</b> ${modeLabel}</p>
        ${typeArme !== "melee" ? `<p><b>Munitions consommées :</b> ${coutMunition}</p>` : ""}
        ${typeArme !== "melee" ? `<p><b>Munitions restantes :</b> ${ammoAfter}</p>` : ""}
      `;

      await this._rollD100(statLabel, baseValue, bonus, item.name, statKey, extraInfo);
    });

    html.find(".item-reload").click(async ev => {
      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");
      if (!row) return;

      const weapon = this.actor.items.get(row.dataset.itemId);

      if (!weapon || weapon.type !== "arme") return;

      if (weapon.system.typeArme === "melee") {
        ui.notifications.warn("Une arme de corps à corps ne se recharge pas.");
        return;
      }

      const typeMunition = weapon.system.typeMunition;

      if (!typeMunition) {
        ui.notifications.warn("Cette arme n'utilise pas de munition.");
        return;
      }

      const ammoItem = this.actor.items.find(i =>
        i.type === "munition" &&
        i.name === typeMunition
      );

      if (!ammoItem) {
        ui.notifications.warn(`Aucune munition ${typeMunition} trouvée.`);
        return;
      }

      const chargeurMax = Number(weapon.system.chargeur ?? 0);
      const currentAmmo = Number(weapon.system.munitions ?? 0);
      const missing = chargeurMax - currentAmmo;

      if (missing <= 0) {
        ui.notifications.info("Chargeur déjà plein.");
        return;
      }

      const reserve = Number(ammoItem.system.quantite ?? 0);

      if (reserve <= 0) {
        ui.notifications.warn("Plus de munitions disponibles.");
        return;
      }

      const used = Math.min(missing, reserve);

      await weapon.update({
        "system.munitions": currentAmmo + used
      });

      await ammoItem.update({
        "system.quantite": reserve - used
      });

      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: `
          <div class="zombie-chat-card">
            <h2>🔄 RECHARGEMENT 🔄</h2>
            <p><b>${this.actor.name}</b> recharge <b>${weapon.name}</b>.</p>
            <p>Munitions ajoutées : ${used}</p>
            <p>Chargeur : ${currentAmmo + used} / ${chargeurMax}</p>
            <p>Réserve ${typeMunition} : ${reserve - used}</p>
          </div>
        `
      });
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

      await this.actor.update({
        "system.stress.value": Math.min(100, current + 5)
      });
    });

    html.find(".stress-minus").click(async ev => {
      ev.preventDefault();

      const current = Number(this.actor.system.stress?.value ?? 0);

      await this.actor.update({
        "system.stress.value": Math.max(0, current - 5)
      });
    });

    html.find(".infection-progress").click(async ev => {
      ev.preventDefault();
      await this._progressInfection();
    });

    html.find(".mental-check").click(async ev => {
      ev.preventDefault();
      await this._checkMentalState();
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
    context.isUsable =
      this.item.type === "nourriture" ||
      this.item.type === "soin" ||
      this.item.type === "objet";

    return context;
  }
}
