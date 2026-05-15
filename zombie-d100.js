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

    } catch (err) {

      console.error(err);

    }

    if (!droppedItem) {
      ui.notifications.warn("Objet introuvable.");
      return;
    }

    const itemData = droppedItem.toObject();

    const stackableTypes = [
      "munition",
      "nourriture",
      "soin",
      "objet"
    ];

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

        ui.notifications.info(`${itemData.name} cumulé.`);

        return;
      }
    }

    await this.actor.createEmbeddedDocuments("Item", [itemData]);

    ui.notifications.info(`${itemData.name} ajouté.`);
  }

  async _rollD100(label, value, bonus = 0, arme = "") {

    const seuil = Math.max(
      1,
      Math.min(100, Number(value) + Number(bonus))
    );

    const roll = await new Roll("1d100").evaluate();

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

    ChatMessage.create({

      speaker: ChatMessage.getSpeaker({ actor: this.actor }),

      content: `
        <div class="zombie-chat-card">

          <h2>☣ RAPPORT DE SURVIE ☣</h2>

          <p><b>Survivant :</b> ${this.actor.name}</p>

          ${arme ? `<p><b>Arme :</b> ${arme}</p>` : ""}

          <p><b>Test :</b> ${label}</p>

          <p><b>Seuil :</b> ${seuil}%</p>

          <p><b>Jet :</b> ${result}</p>

          <hr>

          <h2 style="color:${color};">${outcome}</h2>

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

        ui.notifications.warn("Mode non disponible.");

        return;
      }

      await item.update({
        "system.modeTirActuel": mode
      });

      ui.notifications.info(`${item.name} → ${mode}`);
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

      await this.actor.deleteEmbeddedDocuments(
        "Item",
        [row.dataset.itemId]
      );

    });

    html.find(".item-use").click(async ev => {

      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");

      if (!row) return;

      const item = this.actor.items.get(row.dataset.itemId);

      if (!item) return;

      const quantite = Number(item.system.quantite ?? 1);

      const stressMod = Number(item.system.stressMod ?? 0);

      const faimMod = Number(item.system.faimMod ?? 0);

      const soifMod = Number(item.system.soifMod ?? 0);

      const updates = {};

      if (stressMod !== 0) {

        const current = Number(this.actor.system.stress?.value ?? 0);

        updates["system.stress.value"] =
          Math.max(0, Math.min(100, current + stressMod));
      }

      if (faimMod !== 0) {

        const current = Number(this.actor.system.survie?.faim ?? 0);

        updates["system.survie.faim"] =
          Math.max(0, Math.min(100, current + faimMod));
      }

      if (soifMod !== 0) {

        const current = Number(this.actor.system.survie?.soif ?? 0);

        updates["system.survie.soif"] =
          Math.max(0, Math.min(100, current + soifMod));
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

            <p>
              <b>${this.actor.name}</b>
              utilise
              <b>${item.name}</b>
            </p>

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

      let modeTir = item.system.modeTirActuel || "semi";

      if (typeArme === "melee") {
        modeTir = "melee";
      }

      let coutMunition = 0;

      let bonusMode = 0;

      if (modeTir === "semi") {

        coutMunition = 1;

      }

      if (modeTir === "burst") {

        coutMunition = 3;

        bonusMode = 10;

      }

      if (modeTir === "auto") {

        coutMunition = 5;

        bonusMode = 20;

      }

      const bonus =
        Number(item.system.bonus ?? 0) +
        bonusMode;

      const statKey =
        typeArme === "melee"
          ? "combat"
          : "tir";

      const statLabel =
        typeArme === "melee"
          ? "Combat"
          : `Tir (${modeTir})`;

      const baseValue =
        Number(this.actor.system.stats?.[statKey] ?? 10);

      let ammoBefore =
        Number(item.system.munitions ?? 0);

      if (typeArme !== "melee") {

        if (ammoBefore < coutMunition) {

          ui.notifications.warn("Pas assez de munitions.");

          return;
        }

        await item.update({
          "system.munitions":
            ammoBefore - coutMunition
        });

      }

      await this._rollD100(
        statLabel,
        baseValue,
        bonus,
        item.name
      );

    });

    html.find(".item-reload").click(async ev => {

      ev.preventDefault();

      const row = ev.currentTarget.closest(".item-row");

      if (!row) return;

      const weapon =
        this.actor.items.get(row.dataset.itemId);

      if (!weapon || weapon.type !== "arme") return;

      if (weapon.system.typeArme === "melee") {
        return;
      }

      const typeMunition =
        weapon.system.typeMunition;

      const ammoItem =
        this.actor.items.find(i =>
          i.type === "munition" &&
          i.name === typeMunition
        );

      if (!ammoItem) {

        ui.notifications.warn("Aucune munition.");

        return;
      }

      const chargeurMax =
        Number(weapon.system.chargeur ?? 0);

      const currentAmmo =
        Number(weapon.system.munitions ?? 0);

      const missing =
        chargeurMax - currentAmmo;

      const reserve =
        Number(ammoItem.system.quantite ?? 0);

      const used =
        Math.min(missing, reserve);

      await weapon.update({
        "system.munitions":
          currentAmmo + used
      });

      await ammoItem.update({
        "system.quantite":
          reserve - used
      });

    });

    html.find(".roll-stat").click(async ev => {

      ev.preventDefault();

      const stat =
        ev.currentTarget.dataset.stat;

      const label =
        ev.currentTarget.dataset.label;

      const value =
        Number(this.actor.system.stats?.[stat] ?? 10);

      await this._rollD100(label, value);

    });

    html.find(".stress-plus").click(async ev => {

      ev.preventDefault();

      const current =
        Number(this.actor.system.stress?.value ?? 0);

      await this.actor.update({
        "system.stress.value":
          Math.min(100, current + 5)
      });

    });

    html.find(".stress-minus").click(async ev => {

      ev.preventDefault();

      const current =
        Number(this.actor.system.stress?.value ?? 0);

      await this.actor.update({
        "system.stress.value":
          Math.max(0, current - 5)
      });

    });

  }

}

class ZombieD100ItemSheet extends ItemSheet {

  static get defaultOptions() {

    return foundry.utils.mergeObject(
      super.defaultOptions,
      {
        classes: ["zombie-d100", "sheet", "item"],
        template: "systems/zombie-d100/templates/item-sheet.html",
        width: 560,
        height: 760
      }
    );
  }

  getData() {

    const context = super.getData();

    context.system = this.item.system;

    context.isWeapon =
      this.item.type === "arme";

    context.isAmmo =
      this.item.type === "munition";

    context.isStatus =
      this.item.type === "statut";

    context.isUsable =
      this.item.type === "nourriture" ||
      this.item.type === "soin" ||
      this.item.type === "objet";

    return context;
  }

}
