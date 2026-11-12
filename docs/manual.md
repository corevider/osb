# OSB (OpenSROBot)

A compact OpenSRO bot for hunting, potions, pet loot and automatic town trips.

[Install / update the bot](https://raw.githubusercontent.com/corevider/osb/main/osb.user.js)

## Quick start

1. Install the script with **Tampermonkey**. Disable any other OpenSRO bot script.
2. Reload the game after installing or updating.
3. In **Combat**, save your hunting spot and choose your attack skills, buffs and imbue.
4. In **Combat**, tick the monster kinds **Berserk** should be used on (only Giants by default; it fires once the gauge is full, so the gauge waits for a Giant). In **Loot**, choose what to collect, including **Magic stones** and **Attribute stones**. Tick **Equipment: only SoX** to take only Seal of Star, Moon and Sun equipment; gold, potions and other items follow their own switches. For pet collection, summon your pickup pet and select it as the collector.
5. In **Supplies**, set your HP/MP potion thresholds. Enable **Use beginner +100% speed scroll automatically** if wanted.
6. Press **F8** to start hunting.

Settings are saved separately for each character. The bot checks for updates on load and every 15 minutes; click **Update** beside the version when it appears, install, then reload when ready.

## Setup page

The **Setup** page is the first page and opens by itself for a character that has no hunting spot or attack skills yet. It is a live checklist: character and weapon, hunting spot, attack skills, potions, what to pick up, town trips, pet, and what happens on death. Each row says what is missing and has one button (**Set here**, **Pick skills**, **Turn on**, **Set up town**, **Safe preset**). **Fix the next thing** jumps to the first red item. **Starter settings** (**Level up**, **Farm drops**, **Safe AFK**) are laid over your current settings, so your skills, hunting spot and town stay; the page lists every change first, applies nothing until **Apply**, and **Undo last change** brings your old settings back. The page only reads the game and your settings until you press a button.

## Session window and logs

The **Session** button (or **Pop out session totals and log** under **Settings → Recent activity**) opens **Current session**, a floating window with live hunting totals. The **▼ Show logs** button expands the shared activity history downward. It never opens by itself, it stays on screen when you minimise the bot with the × button, and closing it does not stop hunting. Use **Reset session totals** to clear the totals explicitly. The status lines, the feedback line under the buttons and the wide window's Activity box stay on the main panel; the same history also shows in Settings.

Activity is available under **Settings → Recent activity** and in the session window. Both lists scroll and follow incoming entries only while you are at the bottom. Normal history retains the newest 400 events. Categories, outcomes (requested/confirmed/refused/unconfirmed) and repeat counts help distinguish dispatch from observed results. Alchemy outcomes, game refusals and town-state changes appear here too.

Visible messages use monster names and plain language, such as **Targeting Mangyang**. Technical IDs, selection policy, outcomes and distances remain in diagnostic exports rather than being printed before each message. Standard exports omit names; raw exports explicitly include the original technical message and the readable message. Select log text and press **Ctrl+C** to copy only that selection.

The first game command of each manual-control pause is noted with its kind, for example **Manual control seen: game command select, 2.5 s after entering the game; the bot pauses for 6 s.** Within 30 s of entering the game it is a normal entry, later only in detailed capture. It shows what delayed an auto-start or a buff change right after loading.

Use category/severity filters and search to narrow the view. **Pause log** freezes that view while collection continues; **Follow latest** resumes it. Both views share filters and keep independent reading positions. **Clear history** requires a second click within five seconds and does not reset session statistics.

**Detailed capture (10 minutes)** enables a separate, bounded 1,000-event command trace. Routine commands cannot evict normal warnings. Capture automatically stops after ten minutes; all history is local to this page and is lost on reload. Potion consumption is summarized rather than logging every routine use; detailed capture includes individual observed consumptions.

**Export preview** shows exactly what will be downloaded or selected for copying. Standard JSON/text export omits free-form messages, player names and precise locations. **Include raw local messages** explicitly includes text that may contain private details; review before sharing. Export never uploads anything, and the report you can send to the OSB team does not include this history.

The same game refusal, for example **The game refused an inventory action (code 2)**, appears at most once a minute, with a repeat count on the right; the same holds for a **Skill icon unavailable** warning, which also says how many times it was seen. Routine **Cast rejected: 5** events appear as one informational **Skill not ready yet** row, with a repeat count on the right. They have separate bounded retention so repeated cast readiness messages do not evict normal history. In OpenSRO this means the skill is cooling down or its action is still recovering. A persistent readiness stall without an observed local cast can raise one warning per minute. Refusal evidence is included in exports even when a view filter hides it: request type, decoded explanation, client state and nearby commands, with up to eight recent context examples per group. Nearby commands are explicitly possible context, not an exact request match, because the refusal packet has no request identifier. Other channels' error code 5 is not treated as a skill cooldown.

Under **Supplies → Automatic potion use**, enter **Potion delay (ms)** as a whole number from 0 to 60000. The default is 350 ms. This minimum interval is saved per character; item cooldowns and inventory admission still apply.

Under **Town → Scroll town cycle**, enable the cycle, set up your recall town and services, and enable **Revive in town and go back to the hunting spot**. Choose **Last return-scroll location (hunting area)**, the default, or **Death location** for revival trips. The death location is used only when you died inside the hunting area; a death further away reverses to the last return-scroll point, because hunting starts again only from inside the hunting area. Ordinary repair/sell/refill trips reverse to their departure point. Missing or refused reverse destinations stop the trip without silently switching destinations. Without a reverse scroll, or with **Back to the hunting spot** set to **Walk**, the trip walks back to the saved hunting spot instead (see below). Existing protections for your character's inventory remain unchanged.

## Item rules

The **Items** page lists every item in the game with sBot-style filters under **Filter items** (group, race, gender, type, SoX (Star / Moon / Sun), degree, search, only items with a rule). Per item choose **Pick** always/never and one action: **Store** (warehouse on town trips), **Sell** (pet loot at the repair merchant), **Keep**, or **Drop** (thrown away from your bag or the pet while hunting, never picked up again). Click a cell, right-click a row, or use the bulk buttons for everything shown (second click confirms). Rules come first; other items follow the Loot switches. Your own bag is never sold, and supplies the town trip needs are never stored from it.

The catalogue normally loads from the game's data files. When the site does not serve them, the list fills instead from what the server itself shows: names, icons and codenames of worn, bagged, stored, sold and dropped items are cached as they are seen, kept across sessions, and used the same way — including Star / Moon / Sun detection from the item's codename.

**Combat → Buffs & imbue → Weapons and shield** sets your **Primary weapon**, **Secondary weapon** and **Shield**, picked from what you wear or carry. A choice stays when you wear the item, when it is in the warehouse or the pet, and when alchemy changes its plus or stones. Chosen gear is never sold, stored, dropped, moved to the pet or offered in your stall, whatever its item rule or stall price. **Balance free slots with the pickup pet** is under **Loot → Bag and pet space**.

**Loot → Bag and pet space → Move pet loot to my bag when the pet is nearly full** (off by default) keeps you at the hunting spot longer. When the pickup pet is within two slots of its **Pet free slots ≤** trip mark, its loot moves to your bag one item at a time, as long as the bag keeps two free slots, so the pet can go on collecting. The chosen weapons and shield never move. The bot remembers what it moved: on the next town trip that loot is stored or sold exactly like pet loot, even with **Sell ordinary gear from the character bag too** off, while your own items in the bag stay protected as before. The memory lasts until the page reloads; after a reload, moved loot counts as your own bag. The town trip starts once the bag is full too.

While hunting, the primary weapon is the combat weapon. When something else is worn (after entering the game, a reconnect, a revival or a manual change), the bot puts it back on first, before any buff swap, with the chosen shield when it is one-handed; a bow wears arrows and a crossbow bolts: the worn stack when it fits, otherwise the biggest stack in your bag, and the next one when a stack runs out. Arrows and bolts never count as a shield, so a one-handed primary without a chosen shield takes them off. A secondary bow or crossbow gets its ammunition the same way. Under each buff, **Keep <skill> up** chooses **While hunting** (the default) or **Hunting and walk-back**: a walk-back buff is also kept up while the bot walks back to the hunting spot or between towns — speed or stealth skills stay on for the whole trip. Under each buff, **Gear for <skill>** can be **Primary weapon**, **Secondary weapon** or **Shield (with a one-handed weapon)**: the bot wears it, casts the buff, then goes back to the primary weapon. Automatic buff swaps try the secondary weapon first, then the primary. A primary weapon or shield the game refuses twice is not tried again until you pick it again, and the gear worn before goes back on; any other combat gear move it refuses again waits five minutes. Hunting goes on either way. Without a primary weapon chosen, whatever is worn stays the combat gear.

For the first 5 seconds after entering the game the inventory may still be arriving, so the bot changes no equipment; hunting goes on with what is worn. If the game does not take the combat gear the first time, hunting goes on with what is worn, the Activity log says so once, and it is tried again after 30 seconds. If your primary weapon is chosen but is neither worn nor in your bag (in the warehouse or the pet, for example) for 10 seconds while hunting, hunting stops and says so: put it in your bag, or choose another primary weapon (or None). Putting the combat gear on and your own buff swaps run the same weapon change at most twice a minute; a third one waits, with one line in the Activity log. Party buff changes keep their own limits.

## Monster classes

**Combat → Hunt area → Monster classes** has one row per class, from the weakest to the strongest: **Normal**, **Champion**, **Party normal**, **Giant**, **Party champion**, **Party giant**, **Elite**, **Unique** and **Titan**. Titan has its own row here, though it uses the Unique attack rotation. Each row has three choices:

- **Prefer**: the bot takes a monster of this class before any monster of an **Ignore** class.
- **Ignore**: the usual order. The bot takes it when no monster of a **Prefer** class is available.
- **Avoid**: the bot never goes for it, and fights it only while it is attacking your character.

The order, from the strongest rule down: with the order **Attackers**, a monster hitting your character comes first, whatever its class (an **Avoid** class too). Then the **Preferred monsters** list, by name. Then the class: **Prefer** before **Ignore**. Then the usual order inside (nearest, low HP, small monsters first). The bot does not leave a fight to switch to a **Prefer** class; only the Preferred monsters list does that. Your other filters (level range, **Only these mobs**, **Skip these mobs**, the hunting area, other players' targets, recently given up monsters) still apply to every class. The lure's single-target taunt also picks a **Prefer** class first and never an **Avoid** class, and the area taunt is only used when a monster that is not **Avoid** is at the pull point. Normal, champion and giant start as **Ignore**, the others as **Avoid**. Settings from older versions load with a ticked class as **Ignore** and an unticked one as **Avoid** (the old Party switch sets all three party classes); nothing becomes **Prefer** by itself. Share codes and backups carry the choices.

## Attack rotations

**Combat → Skills → Attack rotation** has one rotation per monster class, from the weakest to the strongest: **Normal**, **Champion**, **Party**, **Giant**, **Party champion**, **Party giant**, **Elite** and **Unique**. Titans use the Unique rotation. Pick a class tab, then click skill icons to build its attack order, as before.

With **Empty rotations use the class below** on (the default), a class with an empty rotation uses the rotation of the next class below it in that order, and if that one is empty too, the next one down, as far as Normal. For example, a Unique with empty Unique and Elite rotations uses Party giant; a Party champion with an empty rotation uses Giant, else Party, else Champion, else Normal. A class never borrows from a class above it. When every class down to Normal is empty, the bot uses normal attacks only (if **Use normal attacks** is on). With the switch off, an empty class uses normal attacks only.

An empty class shows which rotation it uses right now, for example "Empty: uses Party giant", under the tabs and when you point at its tab; it changes as soon as you fill or clear a rotation. The same rotation is used when hunting, when protecting party members and when the bot works out how close it must get to a monster.

Settings from earlier versions keep their Normal, Champion, Giant, Party, Elite and Unique rotations. Earlier versions used the Party rotation for every party monster, so when your Party rotation has skills, Party champion and Party giant start as a copy of it and fight as before; otherwise they start empty. Share codes and settings files carry all eight rotations, and older ones still import the same way.

## Berserk

Under **Combat → Berserk when the gauge is full, on**, tick the monster kinds berserk is spent on (only Giants by default; it fires once the gauge is full, so the gauge waits for a ticked kind). **Also berserk when this many monsters attack at once** (0 = off) fires a full gauge whatever the monsters' kind once that many living monsters attack at the same time — the defensive panic button of a luring tank or an over-pulled spot; it also works while luring, where no target kind is ever consulted.

## Emergency skills

**Combat → Skills → Emergency skills** is a list of up to 6 entries, empty and off by default. Each entry has a learned skill (the highest learned rank of it is used), one trigger and an on/off tick. **Add emergency skill** adds an entry; **Remove** deletes it.

The triggers are:

- **HP below (%)** and **MP below (%)**: the entry holds while your level is below the number. At exactly the number it does not.
- **Attacked by at least (monsters)**: the entry holds while at least that many living monsters have hit you in the last 5 seconds. This is the same count as **Also berserk when this many monsters attack at once**, so the two always agree.

**When it casts**

- Only while the bot runs and the character is alive and in the world: in the hunt, while luring, in the unique hunt and while walking back.
- Not during the town part of a town trip and not while the character sits.
- An entry whose trigger holds and whose skill is ready goes before the attack rotation and the normal buffs. When several entries hold, the list order decides. Potions stay independent and keep their own rules.
- The usual cast rules apply: the **Skill gap**, a skill the server keeps refusing, and the MP check.
- A skill that needs a monster is cast on your current target; with no monster targeted it waits. A self skill is cast on the character.
- An entry is not tried again within 3 seconds of a cast, so a refused cast does not repeat in a loop.
- The log gets one line per cast, for example **Emergency: Heal (HP 23% < 30%)**, and at most one per entry every 10 seconds.

Settings, profiles, share codes and backups carry the list. Older ones load with an empty list.

## Wearing better gear

**Loot → Bag and pet space → Wear better gear**: with **On town trips, wear carried gear with better stats; store the replaced piece** on (off by default), the town trip — while the warehouse is open — wears a carried equipment piece whose real stats beat the worn one in the same slot, and deposits the piece it replaces in the warehouse (it is never sold, even if bag selling is on).

- Real stats means what the tooltip shows: each stat rolls inside its own min~max range (the roll quality, the "+x %"), plus adds its share, and known blues (build stats, hit ratio, HP) add a bounded nudge — so a well-rolled ordinary piece can beat a low-rolled Seal one.
- Weapons are compared on the dominant attack of the worn weapon, so a physical build never swaps to a magical blade. Armour and shields compare physical + magical defence; accessories compare their reinforcement. A swap needs a 2 % edge, so near-ties never churn.
- A piece competes only for its own slot, as the game assigns it: a necklace against the worn necklace, boots against the worn boots, never a necklace against a ring. Rings have two slots: a better ring replaces the weaker of the two worn ones. A piece whose slot cannot be told is left alone.
- It runs before anything is sold. With bag selling on, a full bag visits the weapon merchant before the warehouse, so the merchant leaves any carried piece that would be worn alone until the warehouse visit. If no warehouse is saved, nothing could wear it and the usual selling rules apply.
- When the game refuses to wear a piece (the bot logs one line, for example "Inventory rejected: 14") or does not confirm it within 15 seconds, the piece stays in your bag, is not tried again and is not sold until you reload the game or switch character. What error 14 means is not documented anywhere in the bot or in these docs.
- Never touched: the chosen primary/secondary weapon and shield, buff-set gear, the alchemy item, items with a Keep rule, pieces whose tooltip is incomplete or whose level requirement is unknown or unmet, and zero-durability pieces. Nothing here can stop the town trip.

## Vigor and pet potions

Under **Supplies → Automatic potion use**:

- **Vigor potions:** tick **Use vigor potions** and set **Vigor when HP below** and **Vigor when MP below**. Vigor potions are used when your HP or MP drops that low and the normal HP and MP potions have not been enough.
- **Buying vigor potions:** under **Supplies → Potion restock**, tick **Buy vigor potions**, pick the **Vigor potion size** (Herb, Small, Medium, Large or X-Large; X-Large by default) and set **Vigor low stock** and **Vigor refill to**. Town trips and walking restock buy that size, and a trip is also started when the vigor stock runs low. If the potion merchant does not sell the size you picked, the trip stops with a message so you can choose another.
- **Buying arrows and bolts:** under **Town → Arrows and bolts**, tick **Buy arrows** and/or **Buy bolts** and set the **go to town at or below** count and the **refill to** count (2000 each by default, off by default). They are bought on a town trip at the repair merchant, after selling pet loot and before repairing. The count includes the stack in your ammunition slot and spare stacks in your bag, and a trip also starts when it falls to the low number. If the merchant does not sell the item, there is no bag space or not enough gold, that item is skipped with a notice and the rest of the trip goes on. Equipping the bought ammunition is up to you.
- **Pet recovery kits:** tick **Use recovery kits on my pets** and set **Pet HP below**. When an attack or pickup pet drops below that HP, the bot uses one recovery kit on it, choosing the smallest kit that covers the missing HP (or the largest if none does). Your own potions always go first. The pet's maximum HP is learned from its own HP — the highest value seen while the bot watches (a freshly summoned pet starts full, so that read is the maximum) — and a rested pet is healed again as soon as its HP moves. Each kit has to be seen consumed before the next one is used; a pet that does not take a kit is left alone for 30 seconds, and one whose HP does not rise on confirmed kits rests for five minutes, so a wrong HP reading cannot drain your kits. It is off by default and needs the master **Use potions automatically** switch.
- **Pet HGP (satiety):** tick **Use HGP recovery potions on my pet** and set **Pet HGP below**. When the attack pet's HGP gauge drops below that percentage, the bot feeds it one HGP recovery potion (the smallest that covers the missing satiety, or the largest if none does). Pickup pets have no HGP gauge and are never fed. Each potion has to be seen consumed before the next one; a pet that does not take one is left alone for 30 seconds. It is off by default and needs the master **Use potions automatically** switch.
- **Buying HGP recovery potions:** under **Supplies → Potion restock**, tick **Buy HGP recovery potions**, pick the pet food the recorded merchant sells, and set the low-stock and refill numbers. It is bought on the same refill trips as the potions; a merchant that does not sell pet food skips it with a notice instead of stopping the trip.
- **Buying pet recovery kits:** under **Supplies → Potion restock**, tick **Buy pet recovery kits**, pick the kit the recorded merchant sells, and set the low-stock and refill numbers. It is bought on the same refill trips as the potions; a merchant that does not sell kits skips them with a notice instead of stopping the trip.

## Automatic town trips

With the town cycle on, the walking-route restock controls are hidden because every trip buys potions in town. The **On death** setting is replaced by the town revive option, and the rest thresholds only show while **Rest when low** is ticked.

Set this up once on the **Town** page, under **Scroll town cycle**:

1. Bind your recall to **Hotan, Jangan, Donwhang, Constantinople or Samarkand** in the game. Pick your town in the **Town** list at the top of the Town page; you do not have to be in town. While the bot is hunting, on a trip or recording a route, the pick waits and is applied when you switch the town cycle on or pick again. Choosing a town saves the town's known arrival point (where its return scroll always lands) and fills the **Warehouse**, **Potion merchant**, **Repair merchant** and **World statue / teleport** from the server's NPC data, each as a spot a few metres from the NPC. Choosing the town that is already saved only fills what is empty, so a service you saved by hand stays; choosing another town replaces everything. Switching on **Use return scroll → town services → back to the hunting spot** fills any missing point from the picked town, else from the town of the saved arrival point, else from the town around you. The **Save ...** buttons under **Adjust by hand (optional)** are for changing one point yourself. **Redo all automatically** replaces every saved point, and an arrival point from another town is replaced automatically. **Auto-set town services** does the same for the town you are standing in. If the saved arrival point is not where the scroll actually lands, the bot corrects it itself: after a recall it confirmed, once the character has stood still for three seconds in a known town, it saves that spot as the arrival point and carries on. This is only done in the town the saved services belong to.
2. To do it by hand instead, stand near and select each service, then save its point: **Warehouse**, **Potion merchant**, **Repair merchant** and **World statue / teleport**. Open the potion shop before saving its merchant. Manual saves override the automatic ones.
3. Enable **Buy HP** and/or **Buy MP**, and set the low-stock thresholds. Set **HP refill to** and **MP refill to** in potion counts (defaults: **100 HP / 300 MP**). These targets apply to walking restock and every town trip, including full bags and revival. Town buys X-Large potions.
4. Enable **Use return scroll → town services → back to the hunting spot**. Enable the pickup-pet capacity option if wanted.
5. **Revive a dead pet with a Grass of life**: a dead attack or pickup pet waits in your bag as its summoner item. With this on, that alone starts a town trip; once in town the bot uses a Grass of life from your bag on it (it only works in town) and summons the pet again before the services, so it carries loot again for the rest of the trip. Carry the grass: stable-keepers sell it and the bot does not buy it. A grass that is not accepted, or a pet that cannot be summoned again, only warns — the town services continue without it and the pet is retried at the earliest ten minutes later.
5. Choose **Back to the hunting spot**: **Reverse return scroll** (the default) or **Walk**. With zero-setup leveling on, the character always walks back and the page says so. With the reverse choice, **Buy Reverse Return Scrolls from the Item mall (silk)** appears below it (see below).
6. Carry gold, spare return scrolls (and reverse scrolls for the reverse choice) and at least **two free character bag slots**. Save your hunting spot and start the bot.

When supplies run low or a bag reaches its capacity trigger, the bot recalls to town, handles pet loot, refills pots, repairs gear and reverses to the **last return-scroll point**. With **Walk**, or when no reverse scroll is carried and none could be bought from the Item mall, it skips the world statue and walks back to the saved hunting spot, then hunts again. A walk that cannot reach the spot stops the bot with a message, as **Return & hunt** does.

**Reverse Return Scrolls** have one switch: **Town → Scroll town cycle → Buy Reverse Return Scrolls from the Item mall (silk)**, shown while **Back to the hunting spot** is **Reverse return scroll**. No merchant sells them for gold, so the bot buys them from the Item mall only, with the **Silk budget per bot run** (the same budget as **Supplies → Item mall**, also shown here). Off by default, and nothing is bought while the budget is 0. The switch works without the general **Buy from the Item mall** switch.

- While hunting, the stock is topped up to **Reverse scrolls refill to** (5 by default) once it falls to **Reverse scrolls low stock ≤** (1 by default). "≤" includes the number itself.
- On a town trip without a reverse scroll, the bot orders one from the Item mall after the services, then goes to the world statue and reverses. If the mall cannot deliver (switch off, no budget left, not enough silk, no free bag slot, a refused order, or no delivery within 30 seconds), the trip walks back as before.
- When the mall lists the same item more than once, the bot buys the package that holds only that item, then the cheapest.
- Older settings: the former merchant switch for reverse scrolls is gone. If it was on, the Item mall switch is turned on for you, with the merchant's low and refill numbers when the mall switch was off. Saved settings, backups and share codes (also from the previous bot) are upgraded the same way, and a share code made before this change keeps the reverse numbers it was made with.

If the warehouse, a merchant or the world statue does not open (for example while the town is still loading), the bot does not stop at once. It closes any window that is open, waits a minute, walks back to that service and tries again. Each service gets three tries per trip; if the third one fails too, the bot stops with a message.

- **Pet elixirs, magic stones and attribute stones:** stored in the warehouse. Stones are also deposited from your own bag; elixirs stay in your bag so alchemy can use them. Magic stones include the Astral, Luck, Steady and Immortal stones. Attribute tablets are not stones and count as other alchemy items.
- **SoX gear:** Star, Moon and Sun equipment is deposited in the warehouse from your own bag and from the pet, on the next trip that visits the warehouse. Nothing is stored right after pickup. SoX gear that is part of a saved buff set, the weapon chosen for alchemy, or matches the **Keep in pet (names)** list is never deposited. Switch it off with **Deposit SoX gear in the warehouse**.
- **Sell Star gear instead:** switch on **Sell Star gear too (instead of depositing it)** and Star gear (not Moon or Sun) is sold like ordinary gear (pet loot, and the character bag when bag selling is on) rather than deposited. Keep names, buff-set gear, the alchemy weapon and the level list still protect it. Off by default.
- **Gear by required level:** list levels in **Also deposit gear requiring level** (for example `85`, or `80-90, 100`) and equipment of any kind that requires one of those character levels is deposited the same way, from your bag and from the pet. Listed gear is never sold, even if the warehouse cannot be used. The same protections apply as for SoX. Empty by default.
- **Other unprotected pet loot:** sold at the repair merchant. Ordinary equipment can be sold even with + or blue options.
- **Other seal/rare gear, supplies and matching Keep names:** protected. Character bag items are sold only when you switch on **Sell ordinary gear from the character bag too** (off by default). From the bag it sells only ordinary Chinese and European weapons, armour, shields and accessories that pet-loot rules would sell; any other bag item is sold only with a Sell rule. Pet summon scrolls and flutes, avatars, devil spirits, job suits, fortress weapons, item mall and event items, tablets, powders, potions, scrolls, supplies, Keep names, buff-set gear and the alchemy weapon are never sold from the bag. With the switch on, the trip visits the repair merchant (sell, ammunition, repair) before the potion merchant, and there it sells the character bag first and the pet loot after it, so a full bag is emptied before potions are bought and the trip does not stop at arrival for lack of a free slot; with a full bag it also goes there before the warehouse, because pet loot reaches the warehouse through a free bag slot. Items the game does not let merchants buy (quest and event items) and pet summon scrolls and flutes, in the pet or the bag, are never offered, even with a Sell rule; if the merchant still refuses an item, it is kept and the rest is sold.
- **Surplus supplies:** switch on **Sell surplus restocked potions above the refill amounts** (off by default) and picked-up or overbought stacks of exactly the supplies this profile restocks (HP/MP/vigor potions, pills, HGP, pet kits) are sold at the repair merchant down to their refill amount. Nothing else is ever touched by this switch.

If protected items fill a bag, the bot stays in town and asks you to free space.

A trip walks only to the services that have something to do. The warehouse is visited when there is something to store (pet loot, SoX gear, stones, listed gear levels, loot the bot moved out of a nearly full pet, a piece replaced by better carried gear, or better carried gear to wear). The potion merchant is visited when a supply or the return scrolls are below their targets. The bot learns what that merchant sells on a visit: the size of HP and MP potion it buys when the merchant has no X-Large, and the pet food or recovery kits the merchant does not sell. It keeps this per character and per merchant in the browser, across reloads (it is not in the profile, so share codes and backups do not carry it), until you save the potion merchant again. Until a merchant is remembered, the first trip visits it; after that it is skipped when the supplies of the size it sells are full and there are at least two return scrolls, and a supply it does not sell no longer sends the bot there. The repair merchant is visited when something sells, ammunition or gear is bought, or something needs mending. The log names the stops it skipped ("Town: nothing to do at the warehouse; skipped."). When nothing is left to do, the trip goes straight to the way back.

A completely full character bag no longer stops the trip at once when the bag itself holds something the warehouse takes: the trip goes to the warehouse first, and that makes room. Without anything to store, it still stops and asks you to free a slot.

### What starts a town trip

The **Town** page shows the trip as a row of pictures (return scroll, warehouse, potions, repair, way back) with what each step still needs, and lists what starts a trip under **Go to town when…**:

- Always: the character bag has one free slot or less. Potions, vigor potions and pills at their low-stock numbers (Supplies), and arrows and bolts at theirs (Town).
- **Return when pickup pet is nearly full**, with **Pet free slots ≤**.
- **Weapon is broken**: the equipped weapon is at 0 durability. On by default.
- **Gear is worn**: the most worn repairable item you are wearing is below **Gear durability below (%)** of its own maximum (15% by default). The trip repairs it. Off by default.
- **No XP for a while**: no experience for **No XP for (minutes)** (10 by default). Off by default. **When there is no XP** chooses what happens: **Return to town** (the default, unchanged), or **Move to the next level spot** — hunting moves to the next entry of the level-spot list (the one saved for a higher level) and the no-XP clock restarts for the new spot; when the list has no higher spot left, the town trip happens as usual. Any other return reason (supplies, bag, durability…) still goes to town.
- **On a timer**: every **Every (minutes)** (60 by default). Off by default.

The XP and timer clocks run only while hunting and restart with every trip, so a long trip never starts the next one. All of these need the town cycle on.

## Buff weapon swapping

With **Swap weapons for buffs** and **Wear the weapon each buff needs** on, a buff your current weapon cannot cast is cast with a matching weapon from your bag (taken from the skill's own weapon requirement), then your combat weapon and shield are restored. No saved set is needed. Keep one bag slot free. Imbues and attack skills are not swapped.

Saved sets, described below, are for buffs you assign to one.

In **Combat → Buffs & imbue**, equip your buff weapon and optional shield, name the set and click **Save equipped buff set**. Repeat for other sets (such as cleric and bard), then put your combat gear back on.

Assign each selected buff to its set and enable **Swap weapons for buffs**. While hunting, the bot equips each needed set, casts its buffs and restores your original combat weapon and off-hand. Keep one bag slot free. Assigned buffs are skipped while swapping is off.

The Buffs & imbue page shows, for each buff assigned to a set, how long it has left and what the swap is waiting for, and says why when a buff is due but the swap cannot start (for example a saved weapon that cannot be found in the bag). The swap happens when a buff is about to end, not when you start hunting.

One weapon change covers what uses the same gear. That is your own buffs assigned to it and up to 10 party buff casts (Party → Party buffs) that need it, on the members and on you, cast one after another before the combat weapon comes back. After a minute it stops starting casts and puts the combat weapon back; the rest goes in the next change. Buffs that would run out within a minute are renewed in the same change, so the next change does not follow a minute later. A buff whose cast was only unconfirmed is tried again after two minutes.

Some buffs end when their weapon is removed. If observed, the bot skips that buff until its buff settings change. Reloads discard unfinished recovery. Live-server swapping still needs confirmation.

Every equipment move is confirmed before the next step. The game allows one inventory action at a time, so:

- No weapon change starts while a pet pickup is on its way, and the pet sends no new pickup while a weapon change runs. When a weapon change is due, the pet waits for it.
- Time in which another action (a potion, a pet pickup, your own item use) keeps the inventory busy does not count against a move. A move still unconfirmed after 15 s of its own time, or after 45 s in all, stops hunting with "Equipment move unconfirmed"; the message says when the inventory stayed busy.
- When the game shows it refused a move (it handled the move, or reported an inventory refusal, and nothing moved), the bot sends that move once more. If the game refuses it again, the Activity log says "The game refused to move <item> … twice". A refused move while putting a buff set on skips that set's buffs for two minutes and puts the combat gear back. A refused move while putting the combat gear back leaves what is worn: hunting goes on and the combat gear is tried again after five minutes. Hunting stops only when no weapon is worn. A move is never sent again when anything moved.
- Interrupted or unconfirmed swaps stop hunting; use **Restore combat gear**, or inspect your equipment and choose **Use current gear**.

## Item alchemy

Stop hunting/travel and put the item in your bag: a weapon, shield, armour piece or accessory. In **Alchemy**, select it, set **Target +** and **Maximum attempts** (up to 9999), choose an elixir (the list shows the elixirs of that item's kind) and optionally enable matching-degree lucky powder and the plus **Lucky powder from +**, then click **Start alchemy**. The tab shows the chance of the next attempt and how many elixirs to expect to reach the target, calculated from the server's own data (powder and Luck are counted the way the server counts them; skill and avatar bonuses are not), and a **Results** panel with attempts, successes, failures, destroyed items, the highest plus, what was used and a log of every attempt and fusion.

Under **Stones that help and protect** tick **Use Luck / Steady / Immortal / Astral stones while enhancing** for the helpers you want, set how many charges to keep on the item (1 to 6) and the plus each is used **from** (defaults: Luck 0, Steady 5, Immortal 5, Astral 4). Before every attempt at or above that plus, if the item has fewer charges than you asked to keep, one is fused automatically from a stone of the item's degree in your bag. Nothing is fused for a helper that is not ticked. **Fuse stones now** ignores the plus and only fills the charges. Each stone adds 1 to that attribute: Luck raises the enhancement success chance, Steady stops durability damage and Immortal stops destruction when an enhancement fails (none of them stops the + from resetting; an Astral stone does, from +4). The game takes an Astral charge only while the weapon has more Immortal charges than Astral ones, so before an Astral stone the bot fuses an Immortal stone when the weapon needs one, even below Immortal's own plus or with Immortal not ticked; without an Immortal stone in the bag it stops and says so. The stone must be of the weapon's degree and in your bag, and adding a kind the weapon does not have yet needs a free magic option slot. The bot reads the weapon's current counts and only fuses what is missing, confirms each fusion by the stone leaving the bag, counts a failed fusion (the stone is used up and nothing changes) and carries on, and stops if a stone is missing, the game refuses, the counts cannot be read, or when it reaches the optional **Stop after this many fusions** limit (0 = no limit, the default).

Stops at the target, attempt limit or missing materials. Failures can reduce +, damage or destroy the weapon. **Stop alchemy**, **Stop all** or **F8** prevents further attempts; a sent attempt can still finish. Unconfirmed results pause without retrying.

### Item attributes

Under **Item attributes (stat percentages)** pick, for the item selected above, the lowest percentage you want for each stat (for a weapon: Phy. reinforce, Mag. reinforce, attack rating, Phy. and Mag. attack power, critical; armour, shields and accessories have their own list). Press **Fuse attribute stones**: the bot fuses attribute stones of the item's degree, working down the list, until every picked stat reaches its target. A successful fusion rolls the stat again, so it can come out lower, and it can re-roll another stat of the item, so the bot keeps checking all picked stats. The stone chance is 50% before bonuses and the high steps (80%, 100%) are rare, so set **Stop after this many attribute stones** (100 by default). A stat whose stones run out, or that has none of the item's degree in the bag, is passed over and the next picked stat is done; the log says which. It stops when every picked stat has reached its target, or when the ones still below it have no stones left, and then names the stones that ran out.

## Auto stall

Sell bag items from your own street stall, like sBot's stall tab. On the **Stall** page, give the items a price: **Add a bag item to sell** lists what is in your bag (a new entry starts at 100 gold), and each row keeps its price. Prices are per exact item and saved per character, so the same drop sells at the same price on the next stall. Set a **Stall name** (defaults to your character name), a **Greeting** for visitors, whether to **List the stall on the stall network**, and whether to **Close when everything is sold**.

**Open stall** requires town, standing still, and hunting, travel and alchemy stopped. The bot names and creates the stall, registers one offer per priced stack (the whole stack at your price, up to the stall's slot limit), then opens it for business and watches it: sales are confirmed only when the offer disappears and gold arrives, and the status line shows offers left, visitors and gold earned. A step the game does not confirm within 15 seconds is skipped (an unconfirmed item is not re-offered and the rest of the stall still opens); **Stop stall**, **Stop all** or **F8** closes a stall this page opened. Items already in a stall you opened yourself in the game are left alone; hunting refuses to start while any stall is open. Only the game's own stall state is used — the wire contract was read from the live client, but the flow has only been exercised in simulation, not against the live server.

## Healing and buffing the party

On the **Party** page tick **Buff and heal party members** (off by default). The bot then supports the party with your own skills, one cast at a time, in this order:

1. **Group heal skill** (a skill without a target), when **Group heal when this many are low** members are below **Group heal below (%)**.
2. **Heal skill** on the member with the lowest HP below **Heal below (%)**; tick **Heal myself too** to include yourself.
3. **Party buffs**: pick them from your learned skills that can target a party member. Each goes to every member who does not show it, or only to the names you list under **Only these members**. With **Swap weapons for buffs** on (Combat → Buffs & imbue), **Gear for <skill>** decides what is worn for it: **Automatic** wears the weapon the skill needs from your bag (with **Wear the weapon each buff needs** on), or pick **Primary weapon**, **Secondary weapon** or **Shield**. The bot changes weapons, casts the buff, then puts your primary weapon (or what you wore) back, also while hunting is stopped. A party buff that ends when the weapon changes back waits ten minutes before the next try. Party buffs that need the same weapon go out in one weapon change, up to 10 casts on the members and on you, before your combat weapon comes back. A member who does not take one does not hold up the others. A member whose buff has less than a minute left is renewed in that change too. If the game will not renew a buff the member still wears, the bot waits until it runs out. When the game refuses a buff because the member already wears one it does not stack with (for example Earth Fire Protection or Might Guard of Ice), that member is skipped until that buff ends, at most 30 minutes, and the other members still get theirs. The status line lists who is skipped.

It casts only on members you can see within **Support range (m)** (30 by default) and never walks to them. HP is exact for members in view and in tenths otherwise, as the game's party window shows it. A buff that does not appear on the member after two tries waits a minute before the next. It runs while hunting; tick **Also while hunting is stopped** to support a party while you stand still. For a character that only supports, untick **Attack monsters** (Combat → Hunt area). It then never starts a fight, not even with monsters that hit it, and while hunting it keeps picking up loot, its own buffs and party support, at the hunting spot or beside the member it follows (**Following a party member**). Town trips, revival and the walk back work as usual, and the anti-stuck watchdog does not count the time without kills. The top of the page lists the party with HP and MP bars, distance and which assigned buffs each member has. The party matching, resurrection and recruit options are on the same page.

## Protecting party members

On the **Party** page tick **Protect party members** (off by default). Then tick the members to protect, or **All party members**. When a monster hits a ticked member, the bot switches its target to that monster and attacks it. It works while the bot runs.

- **Maximum distance from you (m)**: 40 by default, the same as the default hunting radius. A monster farther away than this is not attacked, and one that runs past it is not chased. A monster outside the hunting area (or outside the area around the member you follow) is not attacked either.
- **Also with Attack monsters off**: a support character with **Attack monsters** off protects too. Without this option it never fights.
- Several monsters: the one that hits the member with the lowest HP comes first, then the nearest one. While its target still hits a member, the bot does not switch to another attacker.
- A monster the bot could not reach and dropped is left alone for a minute, even while it keeps hitting the member. Protection uses the same obstacle checks as normal targeting.
- When nobody it protects is hit any more (6 seconds without a hit), the bot goes back to its normal targets. A monster that now hits you stays your target.
- Your own safety comes first. While your HP is below your HP potion or vigor potion threshold, the bot does not switch. Potions, death and the return to the hunting spot keep their priority, and a town trip pauses the protection.
- The bot never attacks players. It skips a monster named in **Skip these mobs** (Combat → Hunt area) and a monster another player is fighting, when **Avoid other players' targets** is on. Hits by party members do not count as another player's fight.
- While luring, the luring steps keep their own order.

The bot sees the attacks in the same game events it uses for monsters that hit you: each attack names the monster and the player it hits, for every player in view. A member out of view cannot be protected. Members are saved by character name. A member who leaves the party stays in the list, greyed out; untick the member to remove the name. Share codes and backups carry these settings, and older settings load with the protection off. The log says **Protecting <name>: attacking <monster>, which is hitting them.** when it switches, and **Protection over: back to normal targeting.** when it ends. This was tested in simulation only.

## Resurrecting party members

Tick **Auto-resurrect party members** on the **Party** page to cast your learned Rebirth skill on a dead party member in view. The party list shows HP in tenths, so 0 there can also mean nearly dead.

A member who died while out of view is often drawn standing when you get back to them, because the game only shows deaths it saw. A standing member at 0 in the party list therefore counts as dead, unless the HP the server sent when the player came into view says otherwise. The bot casts Rebirth and the server decides: a nearly dead member refuses it, and the offer is not repeated within its 30-second answer window. A member the server's HP shows alive is checked again after 30 seconds.

Manual control (walking, attacking, skills) pauses resurrection like hunting. If it cuts short a walk to a corpse, the Activity log says **Manual control: resurrection travel cancelled.** once for that walk; a pause without a walk only shows it in the status line.

### Players outside the party

**Also resurrect these players (not in the party)** takes up to 20 character names, comma separated, in any letter case. It is meant for a helper who cannot join, such as a lure character next to a full party of 8. A listed player is resurrected with the same rules as a party member: in view, within **Maximum res distance from hunt spot (m)**, walk into range, cast Rebirth, walk back. It works during hunting and while stopped, and even with **Auto-resurrect party members** off. A listed player who is in your party is handled as a party member. Nobody else outside the party is ever targeted.

The game keeps no party list entry for an outsider, so the bot reads their death from the body alone: a corpse, or a server HP of 0 (sent when the player came into view). A standing outsider without known HP counts as alive, so one who died out of view is resurrected once the game draws the corpse or sends their HP. If the game refuses Rebirth on a listed player (a cast refusal right after the cast), the Activity log says so once and the bot skips that player for 10 minutes. An unanswered offer is repeated after its 30-second answer window, as for party members.

### How often Rebirth is offered again

Two numbers next to the resurrection options set how often the bot tries. They apply to party members and to listed players outside the party alike.

- **Wait between resurrection attempts (s)** is the time from one Rebirth offer to the next offer to the same player, while that player stays dead. The default is 31 s: the game's 30-second answer window plus one tick. It cannot be set lower, because what the game does with a second offer inside the answer window is not known (see below). The highest value is 300 s.
- **Max resurrection attempts per player (0 = no limit)** stops offering Rebirth to a player after that many offers. The default is 0, no limit, as before. When the last offer has run out unanswered, the Activity log and the status line say "Resurrection attempts used up for <name>" once. The count starts again when that player is alive again, leaves the party or the list, or when you press Start.

The skip of 10 minutes after the game refuses Rebirth on a listed player is not changed by these numbers. Saved settings, profiles, share codes and backups carry both numbers; older files load with 31 s and no limit.

Why 31 s at the least: the bot cannot see the dead player's answer, a refusal or a timeout. A new offer sent while the old one is still open would cost MP and a Rebirth cooldown, and the game might refuse it, replace the open question or ignore it. This has not been checked in a live game, so the bot never offers inside the answer window.

## Accepting resurrection

Tick **Accept resurrection from party members** on the **Party** page. When you are dead and a party member casts Rebirth on you, the bot answers Yes, whether or not hunting is running. Offers from players outside your party, and mutation offers, are left to you. The switch is off by default and saved per character.

Tick **Accept resurrection from any player** to also answer Yes to a Rebirth from a player outside your party, for example when your character helps a party from outside it. Mutation offers are still left to you. It is off by default. The Activity log names who resurrected you and whether they were in your party.

If hunting was running when the character died, it resumes after a resurrection you accepted, whatever **On death** is set to: at the hunting spot it simply starts, otherwise it walks back first, however far the spot is (up to about 14 km, walked in short legs), and only stops when the spot is out of reach, in another world or in a dungeon. The memory lasts 15 minutes; a revive you or the bot does yourselves resumes nothing. While this switch is on and an online party member is in view, a bot set to revive (or the town cycle's revive) waits up to 20 seconds instead of 5 before reviving itself, and never revives while a resurrection offer is open.

## Auto-invite players

Off by default. On the **Party** page tick **Auto-invite players** and list character names under **Invite these players** (up to 20, any letter case). The bot sends a party invite to each listed player while they are in view, at any distance. **Also invite anyone nearby** invites every other player within **Invite radius (m)** too, which can annoy other players. Each switch has a tooltip.

Only the party leader invites (or any member, when the party lets members invite), never into a full party (4 members, or 8 with EXP share), and never while the character is dead. A new party takes your **Share EXP in new parties** and **Share items in new parties** choices. The other player still has to accept, or use auto-accept on their side, and can have invites turned off in their game options. A player who does not answer is asked again after 30 seconds, then 1, 2, 4 minutes and so on, up to 10 minutes. One invite goes out at a time, at least 3 seconds apart. With **Join the party leader's party** ticked and a leader name set, the account never invites; only the leader account does. It works while hunting is stopped unless **Only join and accept parties while the bot is running** is ticked. The Party page status line says what it is doing. The settings are saved per character and carried by settings files, share codes and backups; files from before this option load with it off.

## Joining the main account's party

For your other accounts. On the **Party** page tick **Join the main account's party** and type the main character's name. While the character is not in a party, the bot accepts a party invitation from that character, or pages the party-matching board for their listing and applies to it (every 20 seconds at most). It does nothing while the character is in another party, and stops when the party is full or the character's level is outside the listing's range; the status line says which. The main account needs **Auto-recruit** and **Auto-accept party-matching joins** ticked and must not use this option itself. After a disconnect the party is rejoined as soon as automatic reconnect has the character back in the game.

**Leave someone else's party when the party leader is back** makes an alt leave a party led by another character, so it can join the main's party again. It leaves only when the main character is in view and within 30 m of the hunting area (anywhere in view without a saved hunting spot). When the main disconnects, the game makes another member the leader; the party then stays together, with its shared experience, buffs and resurrections, until the main is back at the hunting spot.

The main answers an application within one tick, also while dead or busy. The game refuses an application that is not answered within 10 seconds, so a main that is loading (a teleport, a town scroll) can still refuse one. The alt then applies again, 20 seconds after its last application. Before each new application it reads the party board again: the main's listing gets a new number each time it is registered again (after a disconnect, or when the party broke up), and an application to the old number never reaches the main.

## Starting the bot when you enter the game

Tick **Start the bot when this character enters the game** under **Settings → Behaviour** (off by default, saved per character). Each time the character enters the game (after logging in or after going back to character select), the bot waits about 5 seconds for the game to settle: the character loaded, the inventory known, no manual-control pause, and collision data for up to 20 more seconds. Then it continues from where the character stands, the same way as after a reconnect:

- **At the hunting spot:** it starts hunting.
- **In the town of your saved town services, far from the spot:** with the scroll town cycle on, it does the town services from where it stands, without a return scroll, then reverses or walks back to the hunting spot.
- **Anywhere else:** it walks back to the hunting spot, as **Return & hunt** does.
- **Dead:** it starts hunting so your death handling revives it and returns. With **On death: Stop** and the town revive off, it stays stopped and says so.

It acts once per entry. A teleport or a town scroll is not a new entry. Pressing **Stop all**, **F8** or **Start / stop** before it fires cancels it for that entry. While a reconnect or a page reload brings the character back, auto-start waits for it: if the reconnect resumes hunting, auto-start has nothing left to do; if it does not, auto-start starts the bot once the character is back. A bot you had stopped stays stopped either way. Without a saved hunting spot it does nothing and tells you. The status line shows what it is waiting for.

**It remembers your last Start or Stop.** The bot keeps, per character and across reloads, whether you last started it (**F8**, **Start / stop**, **Return & hunt**, **Start training**) or stopped it (**F8**, **Start / stop**, **Stop all**, **Stop training**).

- **You stopped it last:** auto-start leaves the character stopped on the next entry and says so.
- **You started it last, or never chose:** auto-start starts it.
- **Stops the bot makes by itself** do not change the choice and do not cancel an auto-start that is waiting. Examples: a world transition, a page reload or the settings loading after login.
- **Connection lost while auto-start waits:** the reconnect counts the bot as running and resumes hunting once the character is back.
- **You stop the bot during a reconnect, or just before the page reloads:** hunting does not come back when the character is back.

## Starting again after the bot stops by itself

Tick **Start again when the bot stops by itself** under **Settings → Behaviour** (off by default, saved per character). It is for stops nobody chose, for example a town trip that failed, a walk back that got stuck, a stop on a world change or an internal error.

Every stop writes its reason to the log, for example **Hunting stopped: world change** or **Hunting stopped: stopped by you (F8)**. When the bot does not start again, the log says why.

**When it starts again**

- The bot was running and stopped on its own.
- Your last choice was Start, or you never chose (see **It remembers your last Start or Stop** above).
- It waits 2 minutes, and also 2 minutes after your last manual move, so it does not take over while you play.
- Then it does what **Return & hunt** does: hunting at the spot, town services in your town, or the walk back.
- The status line counts down and names the reason it stopped.

**When it does not**

- **Stops you chose:** out of HP potions, bag full, **On death: Stop**, the anti-stuck and trapped limits, a trip interrupted by manual control, no saved hunting spot, a safety trigger (see **Safety triggers**). These are final.
- **A stop right after your own action in the game:** for example a scroll you read or a portal you took by hand. You moved on, so it is final.
- **You stopped it:** **F8**, **Start / stop**, **Stop all**, **Stop training**, a stop from OSB Manager, or loading other settings. The bot stays stopped.
- **The character leaves the game or you change character:** a waiting retry is dropped. A reconnect or auto-start handles the next entry.
- **The same reason twice within 30 minutes:** it stays stopped, writes a warning to the log and shows it on screen. Check the character.
- **A fourth stop within an hour:** the same.
- **A reconnect or an auto-start is already bringing it back:** it leaves that to them.

## Safety triggers

**Settings → Safety** has four triggers that stop the bot, or send it to town and then stop it, when something risky happens. All are off by default and saved per character, in profiles, share codes and backups.

| Trigger | Setting | What it does |
| --- | --- | --- |
| Deaths | **Stop after this many deaths (0 = off)** | Stops at that death. The count starts with each start of the bot and counts a death once. |
| Party too small | **When the party has fewer than this many members** | Only while you are in a party, or were when the bot started. It waits 10 seconds first, so a member who logs back in does not trigger it. |
| Player attack | **When a player attacks the character** | A hit from another player, seen in the game's cast results as damage on your character. Party members, your own pets and monsters never count. |
| Unique nearby | **When a unique appears nearby** and **Unique distance (m)** | A living unique within that many metres. Never while the Unique hunt runs, and never when **Unique** is set to **Prefer** or **Ignore** in the monster classes, because then you hunt uniques. |

Party too small, Player attack and Unique nearby each have an action: **Stop**, or **Go to town and stop**. Deaths always stops.

**Go to town and stop** starts the normal town trip with the reason "safety: ..." and does the town services. When they are done, the bot stops in town instead of walking back. It needs the town cycle with its services saved, and a return scroll when you are not already in town (it uses one only when a town trip would). Without them the bot just stops.

A player hit is recognised only when the game reports damage on your character. A debuff or a skill that does no damage cannot be told from a buff, so it is not counted.

Every trigger writes one warning with the reason to the log, shows a notice, and the stop appears as **Hunting stopped: safety: ...** in the Activity log, the Session window log and the recent stops of a bug report. A safety stop is your own choice: it is not started again by **Start again when the bot stops by itself**, by auto-start on entering the game, or by a reconnect. Press **Start / stop** to hunt again.

## The Start / stop light

A small light in the left corner of **Start / stop** shows whether the bot is running:

- **Green:** hunting, also while dead and waiting to revive.
- **Yellow:** a town trip, a walk back, a reconnect or other bot work.
- **Grey:** stopped.

Point at the button to read the state.

## Automatic reconnect

This is always on; there is no switch. When the connection to the game is lost (a server restart, a network drop), the bot waits for the game's own retries, then asks the game to resume, and if that fails re-enters the world with the login the page already holds, exactly like pressing Enter at character select. It keeps trying every few seconds, then every 30 seconds, for up to 12 hours. It never types or stores your password: if the login itself is gone after a restart, the status line says so and the bot waits for you.

Once the character is back, hunting that was running resumes: at the hunting spot it simply starts again, otherwise it walks back first, however far the spot is (up to about 14 km, walked in short legs), and if the spot is out of reach, in another world or in a dungeon, it stays stopped and tells you to use **Return & hunt**. A bot that was stopped is reconnected but not started, and a dead character is never started. Choosing logout, disconnect, exit or restart yourself, or logging in or entering a character by hand, cancels automatic reconnect.

### When the game fails to load

If the game's loading screen shows **Unable to finish loading** (for example "Renderer failed: Invalid particle graph time"), the bot waits 15 seconds and reloads the page. It remembers the character and whether hunting was running; after the reload the game restores your login from its own session cookie, the bot enters the character again and hunting resumes as described above. If it still cannot get back in, every further reload in a row waits twice as long as the one before: 15 seconds, 30 seconds, 1 minute, 2, 4, 8, 16, then every 30 minutes, each with a small random extra delay so many bots do not reload at the same moment after a server restart. Once the character is back in the game the count starts over. After 12 hours of reloads without getting back in it stops and says so. If the login cannot be restored, the status line says so and the bot waits for you. Logging out or entering a character yourself cancels it.

If the game shows **Your session ended while the connection was gone. Please log in again.**, the server dropped the session (it only holds a lost connection for about 30 seconds), so resuming is pointless. The bot enters the character afresh instead; if that has not worked after 30 seconds it reloads the page the same way, and further reloads in a row wait twice as long each time (1 minute, 2, 4 and so on, up to 30 minutes). It never presses that window's Confirm button, which would log you out.

If the character was killed while the connection was gone, the bot starts hunting again once it is back, so the usual death handling revives it and walks it back to the hunting spot (subject to your **On death** setting).

An application to the main's party that has not been answered after 30 seconds is sent again, so several alt accounts can join one main.

If the character is back in a known town, far from the hunting spot, and the town cycle's revive option is on, the bot does the town services first (the same trip as after a death), then reverses with the scroll or walks back.

If the plain **Disconnected from the server.** box stays up and the resume and three fresh entries have not brought the character back, the bot reloads the page the same way, with the same growing wait between reloads in a row. A server that is down for hours is still retried every 30 minutes, for up to 12 hours.

## Returning after death

Leave **Revive in town and go back to the hunting spot** enabled under **Town → Go to town when…**. With the town cycle enabled, the bot revives, completes town services and reverses back to hunt. Hunting resumes within 30 metres of the last scroll point, or within your saved hunting area after death. Without a reverse scroll, or with **Back to the hunting spot** set to **Walk**, it walks back to the saved hunting spot instead.

Updates, suggestions and bug reports are on GitHub (https://github.com/corevider/osb); the **GitHub** button at the top of the panel opens the issues page. After an update, a window beside the panel shows the patch notes of every version since the one you used before; the bot keeps running while it is open. Click the version number at the top of the panel to read them again. When a newer version is out, the top of the panel names it and its headline ("Update 1.2.77 available: …") next to the **Update** button.

If something stalls, use **Settings → Send bug report**, which opens a draggable report window over the game. Choose **Bug report** or **Feature request**, optionally add an explanation (and a screenshot with **Add screenshot**: your browser asks which tab to capture, and the picture is shown before anything is sent), and read the preview: it is exactly the text that would be sent. Then either click **Copy report** or **Save report file** and attach it to a GitHub issue, or click **Send** and then **Yes, send**. Nothing leaves your computer before you confirm. A sent report goes to the OSB team at api.osb.lol and shows a report code (keep it if you want the report deleted later); if the server cannot be reached, OSB tries up to three times and then asks you to copy or save the report. Check the explanation for private details.

## Privacy: usage statistics and reports

**Settings → Privacy** holds the switches. Both are off by default, and OSB sends nothing to api.osb.lol while they are off.

- **Share usage statistics:** a short status report about every 10 minutes (bot state, level, gold, HP and MP percentage, scroll counts and the session's kills, deaths, XP, gold and SoX drops), linked to a random install ID, never to your login ID, password or computer. Unticking it asks for confirmation, then deletes your data from the server and wipes the install ID and key on this computer.
- **Show my characters in the OSB dashboard:** also sends the character name; needs the first switch. Turning it off deletes the names at once.
- **Check GitHub for OSB updates** (on by default): about every 15 minutes OSB asks GitHub whether a newer version exists. The request carries no data about you or your game. Switch it off and OSB makes no update request at all; you then update by hand.
- **The game site's unique tracker** (**off by default**; the switch **Use the game site's unique tracker** is in Combat → Unique hunt and at the top of the Setup page's Uniques list, and both are the same setting): only after you turn it on, and then only while the unique hunt runs or the Setup page is shown, OSB reads the game site's own page `/uniques` (opensro.online/uniques, the same site the game runs on), at most every 2 minutes and less often after a failure; **Refresh** in the Uniques list never asks within 30 s of the last request. It is a plain GET with no query string, no cookies (`credentials: 'omit'`) and no data about you, your character or the bot. From the page OSB reads only each unique's state (alive, slain or anything else, read as unknown), its monster number, its level and its map name; the name of the last killer is never read or kept. With the switch off (the default), or when neither the unique hunt runs nor the Setup page is shown, OSB makes no such request at all: not on the Setup page, not in the unique hunt and not on **Refresh**.
- **Show what is sent** shows the next status report; **Download my data** saves what the server holds for this install; **Delete my data** deletes it all; the install ID and the time of the last report are listed too.

Inside OSB Manager the Manager handles usage statistics and OSB shows "Usage statistics are handled by OSB Manager." Reports still go directly and only when you press Send. The full list of requests and the state names is in [telemetry.md](telemetry.md). Privacy contact: privacy@osb.lol.

## Zero-setup leveling

On the **Setup** page, **Zero-setup leveling → Level up by itself** lets a character level with no hunting spot or gear planning. It is off by default and saved per character, so nothing changes for existing settings until you turn it on. Turning it on also sets **No XP → Move to the next level spot** and, if town trips are off, sets up the town picked on the Setup page.

- **Hunting spots:** the bot picks a spot from the game's own monster spawn data (built into OSB, nothing is downloaded): ordinary monsters at most 5 levels under yours. A new character with nothing at its level takes the nearest spot one or two levels up. Spots count from anywhere the game's route data connects to the town your return scroll lands in, so there is no distance setting any more; without route data for the area, spots up to 5 km away count. Spots around the return-scroll town come first; another town's spot is used only through the town move below. Higher level wins first, then more monsters, then nearer. It keeps the spot until one at least 3 levels better is available, then walks there. A walk back to an old saved spot turns to the spot for the level at once. A spot that gives no XP for the set time, or that the walk cannot reach, is passed over for the rest of the session. After five failed walks in a row the bot stops trying new spots and says so. The saved **Spot by level** list (Map page) is not used while this is on. Untick **Pick hunting spots for my level** to keep your own spots.
- **Gear:** on any town trip, the bot buys the next tier of NPC gear: the same weapon type, the same armour material and part, and with **Also buy earrings, necklaces and rings** the accessories. Gear is bought for the character's own race and sex, read from its character model. It wears each piece at once in the shop and, with **Sell the replaced piece back**, sells the old one there. Weapons and shields come from the repair merchant after the sale; armour and accessories add a stop at those merchants before the way back. A worn piece up to +3 is replaced when the town sells a higher level of it. Seal gear is replaced too, but kept in the bag and never sold. Gear above +3, your chosen primary/secondary weapon and shield, buff-set gear and items with a Keep rule are never touched. **Always keep this much gold** (5,000 by default) is never spent. The log says why a piece was not bought ("Leveling gear, not bought: ...").
- **When a gear trip starts:** only a real upgrade of something you wear starts a town trip by itself, once per plan. Empty slots are filled on trips that happen anyway. A tier that opens over a few levels (in Jangan the weapon and boots at 8, the helmet at 11, the chest at 13) waits for its last piece, so one trip buys the whole set; a trip for another reason still buys what is open.
- **Weapon type:** the bot remembers the weapon type the character first held (or uses the build's) for buying, for the mastery and for **Wear better gear**. A dropped weapon of another type never replaces it. **Wear better gear** also swaps a weapon only for one of the same type, with or without leveling.
- **Way back:** the character always walks back to its spot after town trips and deaths. Reverse Return Scrolls are neither used nor bought, and the Item mall's reverse buying pauses too. Turning leveling off restores the **Back to the hunting spot** setting.
- **Full bag:** town trips sell the bag first, as with **Sell ordinary gear from the character bag too**, so spare gear makes room for the pet's loot and a full bag no longer stops the trip.
- **Moving to the next town** (**Move to the next town when this one has no better gear**, on by default): when your town sells nothing better than what you wear and another town's next tier is open for your level (Jangan's gear ends at level 21, Donwhang's next tier opens at 24), the next town trip goes on to that town after its services. It takes that town's world statue teleport, or a ferry when that is cheaper, opens the new statue's menu and makes it the return point. Only the game's own confirmation counts. Then the town services are set up there, a first trip buys that town's potions and gear, and the character walks to a spot of the new town. A move that fails leaves the return point as it was and is tried again after 10 minutes; a death on the way only puts it off until after the revive.
- **The town the character is really in:** with leveling on, the saved town services follow the town the character starts in, revives in or lands in with the return scroll, so a trip never walks across the map to another town's warehouse.
- **Skills and stats** (with **Raise my weapon mastery, learn its skills and use them**, on by default): once per character, in the game, the bot sets up what is not set up yet: **Auto mastery** raises the mastery of your weapon (a sword or blade trains Bicheon, a two-handed staff Wizard, and so on) up to your level and, with **Skills to upgrade: Every skill of my chosen masteries**, learns each of its skills as soon as the game allows; **Auto stat points** go to Strength, or to Intelligence for a caster (a Wizard, Warlock, Bard or Cleric weapon, or a character that already has more Intelligence than Strength). Masteries or a stat share you already chose are kept. Each newly learned attack skill of those masteries joins your normal attack rotation, and each new self buff your buffs, once: a skill you take out stays out.
- **Cold, Lightning, Fire and imbue:** in Auto, Auto mastery also raises the Cold, Lightning and Fire masteries after the weapon's mastery (skipped for a character that has none), once per character and only while the list is just the weapon's mastery. A learned weapon imbue skill is put in the empty imbue slot once; taking it out by hand keeps it out.
- **Character build:** **Auto (from my weapon)** works as described above. Or pick a build for your race: Glaive nuker, Spear fighter, Blade tank, Sword fighter, Bow nuker, Force support, Wizard, Warlock, Warrior, Rogue, Cleric or Bard. A build raises its masteries in its own order, learns and uses only its own skills in its own order (Auto mastery's choice **The skills of my character build**), uses one imbue (a higher tier replaces the lower one), and buys its weapon type and, for a shield build, a shield. The line under the list says what the build does. Changing the build sets the character up again.
- **Skills that keep the character from moving:** walls such as Crystal Wall and Fire Wall root the character while they stand. Leveling never adds them, nor auras that drain MP, teleports, dashes, hiding, traps, transformations or Resurrection. Such a skill that leveling added before comes out of the rotation and buffs. One you added by hand stays, with one line in the log.
- **Pickup pet:** once per character, while pickup is still at its plain default, a summoned pickup pet takes over collecting the drops, gold and gear included. A pickup you set up yourself is kept, and switching back by hand stays.

Share codes carry the switches and the build, but not what was already set up for a character: the set-up record, the elements and imbue records, the pickup pet record and the remembered weapon type stay out, so an imported code sets up the importing character again. The full local backup keeps them.

Limits: spots are measured from your town, so a character that outlevels the area around its town keeps the best spot in reach until the town move takes it on. Spots come from spawn positions, not from live crowding. The town move, the builds and the ferry choice were tested in simulation only.

## Unique hunt

The **Unique hunt** card on the **Setup** page has its own **Start**, **Stop** and a status line ("Patrolling: spot 2 of 5", "Going for Tiger Girl (82%)", "Tiger Girl killed; collecting drops", "Stopped: Tiger Girl killed."). **Settings** opens **Combat → Unique hunt**.

- **What it does:** it walks a patrol of unique spots and fights only uniques, with your Unique rotation, berserk, imbue, buffs, potions, party support and resurrection as in normal hunting. When the unique it went for (or hit) dies, it plays the **kill chime**, writes "Unique killed: <name>" to the log, shows a notice, counts it under **Session stats → Uniques killed**, picks up the drops with your pickup settings (that unique's own drops first, for at most 40 seconds) and stops. The bot is then idle: it does not start hunting by itself.
- **Your hunting settings stay as they are.** The saved hunting spot, radius, monster classes and rotations are never changed; the mode only applies its own rules while it runs. Distances count from the patrol spot it is at, or from where you started it when there are no spots, never from the hunting area.
- **It runs alone.** It does not start while hunting, a town trip, a quest visit, auto trade, a stall, alchemy, Sell Star or a walk is running, and none of them starts while it runs (town trips for supplies still do, see below). F8, **Start / stop**, **Stop all** and **Stop** on the card end it. Starting it counts as your own stop for auto-start, so the next time the character enters the game the bot stays stopped until you press Start; starting again by itself does not bring the mode back, and a reconnect does not resume it.
- **Targets:** uniques only; tick **Titans too** for titans. With **Fight monsters that hit me** (on by default) a monster that hits you is fought; every other monster is ignored. A unique that hits you is always fought back. **Chase distance** sets how far it goes for a unique.
- **Others fighting the unique:** the drop goes to whoever dealt the most damage. A unique other players are fighting is skipped once they have brought it below **Skip a unique others have brought below this % HP** (75% by default: to win the drop from there you would have to deal damage more than twice as fast as everyone else together). A unique nobody else fights is always taken. During a fight the bot compares the damage it sees (its own, its party's and other players') and the unique's HP, and gives up when the others will clearly end with more damage. It never gives up on a unique that is hitting you. Each decision is written to the log once per unique.
- **Patrol:** **Add this spot** saves where you stand, with an optional name (name a spot after its unique, for example "Tiger Girl"). Spots can be moved up and down and removed; they are saved per character and carried by settings files, share codes and backups. The bot walks them in order with the normal walk-back movement (teleports and ferries too when **Walking back may use teleports and ferries** is on), and loops. On arriving anywhere it looks around for about 2 seconds, a little longer while monsters are still coming into view (at most 5 seconds), so that a unique standing there shows up; then, with no unique (or, with **Titans too**, no titan) in view, it goes on to the next stop. **Wait at each spot (s)** (0 by default) adds a wait at your own spots only, where a unique may appear later; the game's nests and learned spots never wait longer than the look around. Settings saved with a wait, for example 30 s, keep it for your own spots. A spot it cannot reach twice is left out; when no spot is left, it stops. With no spots it waits where you started it.
- **The game's unique nests:** tick **Patrol the game's unique nests** (under **Unique nests**, off by default) and the patrol also walks the places where uniques spawn, read from the game's own data files the page already serves (no setup and no other site). The list below the switch shows each known unique with its number of nests; tick the ones you want, or none for all of them. The bot knows the 13 uniques by the game's own monster numbers (Tiger Girl, Cerberus, Captin Ivy, Uruchi, Isyutaru, Lord Yarkan, Demon Shaitan and the six Ch'in Tomb uniques), reads their names and spawn points from the game's data, and also knows any other unique the game announces by name or that it has seen; what it learns is kept on this computer only. One unique is one row: when the game has several monsters with the same name, OSB uses the one with the known monster number (else the one seen as a unique, else the lowest number), so a quest or event copy never adds a second row or walks you to its spawn points. A tick, state or level saved for such a copy by an earlier version is moved to the real unique when the list loads. A few nests come from players' reports because the game's data lacks them (one for Lord Yarkan today); they join that unique's nests like any other, and a game nest within 40 m of one replaces it. Your own spots named after a unique (for example "lord yarkan fertility") still match it by name, in any case and as part of a longer name. Nests closer than 40 m count as one. Only nests within **Furthest nest from the start point** (1000 m by default) of where you start the hunt are walked, and never ones in another world or a dungeon; long trips use teleports and ferries only when **Walking back may use teleports and ferries** is on. The status line says where it goes, for example "Patrolling: walking to Tiger Girl nest 2 of 4", and the map marks the chosen nests with red rings. The switch, the ticked uniques and the distance are saved per character and carried by settings files, share codes and backups. If the game data cannot be loaded, the log says so once and the patrol uses your spots and learned spots.
- **Patrol order:** your spots first, in your order; then the chosen nests, nearest to the start point first and then as a short tour; then learned spots. A nest or learned spot within 40 m of an earlier spot is not walked twice.
- **Learned spots:** every unique the bot sees, whether the mode runs or not, is remembered with its name and place, on this computer only (nothing is sent anywhere). One place per unique within 40 m. Tick **Also patrol learned spots** to walk them after yours; **Clear learned spots** forgets them.
- **Game notices:** when the game announces that a unique appeared, the patrol goes first to that unique's nests (nearest first) and to your spots whose name contains its name, then goes back to the normal order. When the game announces that unique was killed, that priority ends, and if it was the unique being chased, the chase ends.
- **When a kill counts as yours:** a unique the bot went for, selected or hit (also one you hit yourself during the manual-control pause) counts as your kill, and the mode collects the drops and stops, when any of these shows its death: its HP reaches 0 or it is shown dead, a hit is reported as fatal, the game announces it was killed (while it is the bot's goal, or within 15 s after it left view), or it disappears at 20% HP or less within 5 s of your last hit. A unique that leaves view at higher HP, or long after your last hit, is lost, not killed, and the patrol goes on.
- **Which uniques are alive:** the bot keeps an alive or dead state per unique, from the game's announcements (appeared means alive, killed means dead), from what it sees and from its own kills; with **Use the game site's unique tracker** turned on, also from the tracker (see below). Only the state, the time and where it came from are kept, on this computer; never a player's name. The patrol skips the nests and the named spots of a chosen unique known to be dead; a spot without a unique's name is always walked. When every chosen unique is dead, the character stands where it is and waits, and the status says why, for example "Waiting: Tiger Girl was killed 12 min ago." It goes on as soon as the game announces the unique again or the tracker shows it alive. Without newer news a death is trusted for **Trust a unique's death for (min)** (30 minutes by default, 5 to 240): the game announces every appearance, so the trust time only matters when an announcement was missed, for example after reloading the page. The **Unique nests** list shows the state, for example "Tiger Girl · 4 nests · killed 12 min ago" or "· alive".
- **The game site's unique tracker:** **Use the game site's unique tracker** (off by default; nothing is requested until you turn it on) lets the unique hunt also read the game site's live list of uniques (opensro.online/uniques). Once you turn it on, it is read only while the unique hunt runs or the Setup page is shown (and the panel is visible): at most every 2 minutes, and less often after a failure. A unique shown as slain counts as dead from the first time the bot saw it slain (the page shows no times), shown as "slain on the unique tracker (first seen 3 min ago)"; one shown as alive counts as alive. Any other state, such as "Not up", is read as unknown, and the log says once which ones it saw. The tracker never overrides what the game itself announced in the last minute. If the page cannot be read or looks different, the log says so once and the bot goes on with the game's own announcements. The line under the switch says when it was last read. Nothing about you is sent; see Privacy.
- **Uniques on the Setup page:** right under the Unique hunt card, the **Uniques** list shows every known unique, **lowest level first** (Tiger Girl 20, Cerberus 24, Captin Ivy 30, Uruchi 40 and on up to the Ch'in Tomb uniques at 98 to 100). Each row reads in one glance: the name, its level and map on the left, and on the right a coloured state pill with the number of nests under it. The pill always carries its word, so colour is never the only signal: **Alive** (green), **Slain** (red; the line under the name says "killed 12 min ago" or "slain on the unique tracker (first seen 3 min ago)"), **Not up** (amber) and **Unknown** (dim, dashed). Hover a pill to see where the state came from (unique tracker, game announcement, seen by the bot or our kill). The 13 uniques' levels are built in (the tracker's level is used when it reads one), so the order holds with the tracker off; a level the bot saw on the monster itself is remembered per unique on this computer for any other unique. Uniques with no known level come last, by name.
  - **Hunt column:** the tick in the **Hunt** column chooses which uniques the Unique hunt looks for (hover a tick: "Look for this unique in the Unique hunt"); with none ticked it looks for all of them. It is the same choice as the **Unique nests** list under Combat. Ticking a unique also turns on **Patrol the game's unique nests** when it is off, and a notice says so; unticking never turns it off.
  - **Tracker switch:** at the top of the list, **Check the game site's unique tracker (every 2 minutes while this page is open or the Unique hunt runs)** is the same setting as in Combat → Unique hunt, and it is off by default. With it off, the line at the top says the states come from the game's announcements and what the bot saw, nothing is requested from the game site, and **Refresh** is hidden. With it on, the line says when the tracker was last read, and **Refresh** asks again, but never within 30 s of the last request.
  - **Map:** click a unique's name for a small map of its nests, read from the game's own data: the nests as red rings, your position as a white dot when you are in the same world, and the distance to the nearest nest; a unique that spawns only in a dungeon says that there is no map for dungeons. The map only shows; it changes nothing. No player name is shown or kept.
- **Safety:** potions, rest, "Stop when HP potions run out" and "Stop when bag is full" work as in hunting, and a town trip for supplies, a full bag or repairs returns to the patrol spot afterwards. The "no XP" and "every N minutes" town trips wait while the mode runs. A death stops the mode and says so. **Stop after** (60 minutes by default) ends the patrol; a fight that is going on is finished first.
- **Sounds:** **Chime when a unique monster comes into view** (off by default, the same switch as under Alert sounds) and **Chime when the hunted unique dies** (on by default, a different tune). Each has a **Test** button. A unique that dies without the bot having gone for it or hit it plays nothing; leaving view is not a kill.

## Auto mastery and skills

Under **Settings → Auto mastery and skills** the bot can spend skill points for you, one confirmed level at a time. It is off by default and saved per character.

**Skills to upgrade** can be only the skills in your rotations, buffs and imbue, all skills you have learned, **Every skill of my chosen masteries**, which also learns new skills of the ticked masteries as soon as their requirements are met, or **The skills of my character build**, which does the same for the skills of the build picked under Zero-setup leveling.

- **Masteries:** tick **Raise selected masteries automatically** and tick the masteries you want, in the order you want them raised. A mastery stops at your character level (or 120) minus **Keep this many levels below my level**. Level 0 is free; otherwise the price is the table cost of its current level.
- **Skills:** tick **Upgrade my rotation and buff skills automatically** to learn the next level of the attack, buff and imbue skills you already use. It applies the game's own requirements: the skill must be trainable and the next level of its group, and your mastery levels, prerequisite skills, STR, INT and skill points must be enough. Skills outside your rotations, buffs and imbue are never touched.
- **Reserve:** **Keep this many skill points unspent** is never spent on masteries or skills, for example to save points for something you will learn by hand.
- **Max every skill:** a switch (same page, below the options), off by default and saved per character. While it is on, the bot learns and upgrades every skill, level by level, including skill lines you have not started, as fast as the game answers. It raises a mastery only when that mastery is what blocks a skill (up to your character level, or 120), ignores the gap and reserve settings, and when nothing more is allowed it says what is left (for example skill points, strength or intelligence). It then stays on and spends new skill points as you get them, after a level up for example; a pass that finds nothing new stays quiet, and a level the game refused waits a minute. Turn it off to stop.
- **Order:** **Spend skill points on** chooses masteries first, skills first, or alternating after each confirmed level.

It works while hunting is stopped and does nothing while you are dead or during a town trip. If the server refuses a level (for example its mastery total limit) the bot waits a minute before trying that one again.

## Luring monsters to the party

For a tank whose party does the killing. Under **Combat → Hunt area → Lure** (the Training page in the classic window), save a hunting spot, then walk to each place you want monsters pulled from and click **Add pull point here** (points A, B, C…, up to 26). Choose a **Single-target taunt** and an **Area taunt**, and tick **Lure instead of hunting**. Start / stop (F8) and **Stop all** work as for hunting.

Each round the character walks to the next point, casts both taunts (the area taunt first, then the single-target taunt on the monster nearest to the point, within **Search radius at a point**), walks back to the spot and holds there for **Hold at the spot (s)** (10 s by default) so the damage dealers take the monsters over, then goes to the next point. On the way back with monsters it stops for **Pause length (s)** after every **On the way back, pause every (m)** (4 s every 10 m by default; 0 m turns the pauses off) so they keep up. On the way back the single-target taunt is cast again on a monster pulled at this point that falls more than 10 m behind and is within the skill's range (at most once per 10 s per monster, never when hurrying back on low HP); the area taunt is never cast on the way out, on the way back or at the spot. If a chosen taunt is still cooling down when it arrives, it waits at the point for up to 10 s; when the area taunt is still not ready after that, the single-target taunt goes out without it. The lure never attacks. Below **Back to the party below HP (%)** it gives up the pull and walks straight back without pauses. A point with no monster sends it back with no hold. **Stop when this many other players are within 30 m** (0 = off) stops the bot when strangers come close — party members never count; **Stop after this many completed pulls** (0 = off) ends the session after a chosen number of pulls. Potions, town trips, manual pause and death handling work as for hunting; each start begins at the spot. If a point cannot be reached, hunting stops with the reason. Pull points are kept per character and in shared settings' personal part.

## Following a party member

Under **Party → Follow a party member**, tick **Follow a party member while hunting**, choose the member (the default is the party leader) and **Stay within (m)**. While hunting, the bot stays within that distance of the member and hunts around them instead of around your saved hunting spot. The game tells the party where each member is, so it also follows them across the map, up to 300 m, walking around obstacles when collision data is loaded and stopping beside them. **Fight monsters that attack on the way** lets it defend itself instead of walking on. Your saved hunting spot is never changed; it is used again whenever following is off or the member is not in the party, dead, in another area or too far. It does not follow into a dungeon or another area. The stuck check does not count waiting for the member. The status line says what it is doing.

## Auto stat points

Under **Settings → Stat points** tick **Spend stat points automatically** and the bot spends your unspent stat points on Strength and Intelligence as you level up, one point at a time, each confirmed by your unspent count going down. **Strength share** and **Intelligence share** are a ratio: 1 and 0 puts everything into Strength, 0 and 1 everything into Intelligence, 2 and 1 spends two Strength points for every Intelligence point (counted from the points this bot spent since it loaded). **Keep this many points unspent** holds some back. A point the game does not accept is not resent for a minute. It does nothing while you are dead and is off by default.

## When the character uses normal attacks instead of skills

The main panel's status line now says why, for example "Combat: normal attack (1 cooling down)". The reasons are: not learned, paused after a server rejection (the bot skips a skill the game keeps refusing, for 5 to 40 seconds), cooling down, not enough MP, MP below your configured minimum, or no skills in the rotation for that monster class. The same reason is written to Settings → Recent activity (at most every 30 seconds) and included in bug reports as counts only, never skill names. A skill is only treated as rejected after a newer game update arrived and its cooldown still had not started.

When no monster is being attacked, the status line says why, counted from the monsters in view: for example "Monsters in view: 5. Skipped: 3: monster type is avoided (Combat > Hunt area > Monster classes); 2: too far (Hunt radius or Chase distance)." The reasons are: monster class set to **Avoid**, level outside your minimum or maximum, name filters, too far, another player is fighting it, and recently given up. With nothing in view it says so. The same line is part of bug reports, as counts only.

**Small monsters first** (always on): while fighting a stronger monster, the bot switches to a weaker one that is hitting you, kills it and goes back. It only counts monsters that hit you in the last few seconds within chase distance, only switches to a weaker class (normal, champion, elite, party, giant, titan, unique, weakest first), finishes a target that is below 25% HP, and never switches during a cast. The status line says "switched to … (hitting you); back to … after".

**Preferred monsters** (Combat > Hunt area, empty by default) is an ordered list of up to 10 monsters, best first, for quest monsters and drop farming. Add one from the monsters in view or seen this session, or type part of a name (any letter case, like **Only these mobs**). The arrows move a row and × removes it. A listed monster is fought before any monster not on the list, and a higher row before a lower one; among monsters of the same row, or not listed, the monster classes (**Prefer** before **Ignore**) and then the usual order apply (attackers, nearest, low HP). With the order **Attackers** a monster that is hitting you still comes first, so a preferred monster walking in never makes you ignore one that attacks. The list never adds a monster your filters exclude: monster classes set to **Avoid**, level range, **Skip these mobs**, the hunting area, other players' targets and recently given up monsters all still apply, and **Only these mobs** still filters. While you fight, a preferred monster at least 2 rows higher than your target (any listed monster, when the target is not listed) pulls the bot over to it, once every 5 seconds at most. The bot never leaves a target that is hitting you, never switches during a cast, and only takes a monster inside the hunting area and the chase distance. The switch is an ordinary target change, and the status line says "switched to … (preferred)". Quest monsters learned by Auto quest are still taken before this list. Share codes and backups carry the list; old ones load with it empty.

**Avoid other players' targets** (on by default) skips a monster another player has just hit. Hits by your party members, and by their pets, do not count, so the bot joins the monsters your party is fighting. **Avoided monsters** chooses **All monsters** (the default) or **Normal & champion only**: with the second choice, giant, party, elite and other strong monsters that another player is fighting are still attacked. **Spare engaged giant/party below % HP** (50 by default, 0 = off, 50 at most) applies only to **Normal & champion only**: a giant or party monster another player is fighting is skipped once its health is at or below that percentage. A monster whose health is unknown is never skipped for this reason.

**Weapon imbue** is renewed as soon as it runs out, also in the middle of another skill's cast and before a normal attack. A skill takes the imbue when its cast ends, not when it starts, and the game accepts an imbue during a cast, so the skill being cast still gets it. An imbue's cooldown is as long as the imbue itself, so it cannot be renewed earlier; the 1.2.74 setting **Renew imbue when seconds left** was removed in 1.2.75 because of that.

When the pickup pet is ready but collects nothing, the status line says why, counted from the drops in view: for example "Drops in view: 4, ready to collect: 1. Not collected: 2: not wanted by your Loot settings (1 equipment, 1 other items); 1: too far from you (Pickup radius)." The part in brackets names the item kinds that are switched off, so you can see exactly what to switch on. The reasons are: type switched off or excluded or SoX only, too far from you, outside the hunting area, belongs to another player, too far from the pet, the pet is not ready, no room in the bag, and recently failed. **Finish current fight before character pickup** only affects a character collector; a pickup pet collects during fights whatever it is set to.

## Auto skill upgrades: which skills

**Upgrade my rotation and buff skills automatically** (Settings → Auto mastery and skills) raises the next level of skills you have **already learned** and that are in your attack rotations, buffs or weapon imbue on the Combat tab. A skill that is in none of those lists is never raised, and new skills are never learned. The status line under the switches names each skill it is not raising and why (not learned yet, already at its highest level, mastery or strength too low, prerequisite missing, not enough skill points). **Skills to upgrade** can be switched from the default (only those lists) to **All skills I have learned**: the skills you use are raised first, then every other skill line you already have, still only the next level of skills you already know. The order dropdown only matters when both the mastery and the skill switches are ticked.

## Waiting for a party resurrection

With **Accept resurrection from party members** on, the bot waits **Wait for a party resurrection (s)** (20 seconds by default) after dying before it revives itself whenever a living party member is in view (seen in the last 15 seconds counts), so the member has time to resurrect it. With **Accept resurrection from any player** on, any living player in view counts as a helper. Without a helper in view it revives after 5 seconds. The Activity log says which when the character dies, and an open resurrection offer is always answered first.

## A character that cannot move

A character that should be walking (chasing, returning or picking up) but has not moved at all for 20 seconds, with nothing being damaged, is treated as stuck, for example inside a tree. The bot first steps back to the last position it was walking from, then walks to the nearest open ground (this needs the game's collision data). If both fail it stops hunting with an alert chime and a message, instead of standing there for minutes; it never uses a return scroll by itself. The Activity log and the bug report say whether the collision data thinks the character's tile is blocked. Switch it off or change the time under **Settings → Obstacles**.

## Why did it go to town?

Every town trip writes its reason to the **Activity** log, for example "Town trip started: potions running low", and the town status line repeats it during the trip. The Activity log is in the Wide window (press **Wide** in the title bar). The reasons are: character bag nearly full (always on), pickup pet nearly full, potions or ammunition low, weapon broken, gear worn down, no XP for a while, every set number of minutes, returning after a death, a safety trigger ("safety: ..."; the bot stops in town, see **Safety triggers**), or started by you. The bug report includes the reason of the current or last trip.

## Picking up one item without its whole kind

On the **Items** page, **Pick always** takes one exact item whatever the Loot switches say, so you do not have to switch on potions, equipment and so on just to get one item. A rule is for that exact item: each size or degree is its own item. Tick **Only items on the ground now** to list just the drops in view and set the rule on exactly what is dropping. When something is skipped, the pickup status line shows the item numbers behind it (for example "12 potions #19 #20"); the Items table shows the same number when you point at an item.

## Pick up drops

**Loot → Collection → Pick up drops** is the master switch for picking up. With it off, drops stay on the ground whatever the kinds below say. It is the first control of the group and is the same setting as the **Turn on** button of the "What to pick up" row on the Setup page.

### The pet while you play by hand

**Loot → Collection → Pet keeps collecting while I play by hand** is on by default. When you walk, attack or use skills yourself, the bot pauses for **Manual control pause (s)** (6 s by default). With this switch on, that pause no longer stops the pickup pet: only the pet moves, never your character, so it keeps collecting while you play, with the bot running or stopped. The character's own pickups and hunting still pause as before. Turn it off to have the pet wait for the pause too, as in 2.0.4. Saved settings, profiles, share codes and backups carry the switch; older files load with it on.

The game allows one inventory action at a time. While a pet pickup holds it, the game greys out its inventory buttons, the Item Mall buttons included, and quietly ignores an item use, a move or a purchase. So your own use of the inventory always goes first, with the switch on or off:

- After you use or move an item, drop an item, pick something up yourself, or use a shop, the storage, a trade, a stall or alchemy, the pet sends no new pickup for 2.5 s. Walking, attacking and skills do not hold the pet.
- After you open or use the Item Mall, the pet sends no new pickup for 60 s, counted again from each mall action. The bot cannot see whether the mall window is still open, so it waits this long instead.
- While a trade, a stall or the alchemy window is open, and while a shop or the storage is open, the pet waits.
- After each pet pickup the bot waits 0.8 s before the next one, so a click of yours can get in between.
- A drop the pet cannot reach is given up until it disappears once the pet has failed on it 6 times, or once its pickups have held the inventory for 15 s in total. A drop the game refuses to give the pet twice with an inventory refusal (for example **The game refused an inventory action (code 2)**) is given up after the second refusal. A drop the pet can reach is collected as before.
- While a buff weapon change runs or is about to start, the pet waits (see Buff weapon swapping).
- The bot never repeats or blocks a command of yours. An Item Mall purchase is never sent again.

The bot's own item moves and drops (item rules, pet-to-bag balance) and its Item Mall buying wait the same way. Potions are never held back.

### The pet while the bot is stopped

**Loot → Collection → Pet collects while the bot is stopped** is on by default. With it on, the pickup pet collects drops near it while the bot is stopped, but never so that it locks you out of your own inventory. A click on a greyed-out button sends nothing to the game, so the bot watches your input instead of your commands:

- **Pet waits after your clicks and keys (s)** (3 s by default, 0 to 30): after any mouse click, key press or mouse-wheel scroll in the game, the pet starts no new pickup for this long. It collects in your pauses. Clicks, keys and scrolls inside the OSB window, and OSB's F6, F7 and F8 keys, do not count. The bot only notes the time of your input: it never blocks, changes or repeats it. The same hold applies during the manual-control pause while the bot hunts; a hunting bot that you do not touch is not held.
- **Pet reach while the bot is stopped (m)** (25 m by default, 5 to 50): with the bot stopped the pet only takes drops this close to it. A pet pickup holds the inventory until the pet has reached the drop, so a near drop means a short hold. While hunting the pet keeps its full reach of 50 m.
- With the bot stopped, the pet keeps at most about a third of any 10 seconds for itself: a new pickup starts only when the pet's inventory time in the last 10 seconds plus the length of its last pickup stays within 3.3 s. After one long pickup the inventory then stays free for 10 s.
- After a return scroll, a reverse return scroll or any teleport, the pet waits until the cast has ended and the new world has been loaded for 3 s. This also applies while hunting.

Turn the switch off and the pet collects only while the bot runs. Saved settings, profiles, share codes and backups carry these settings; older files get the defaults. The pet status line says why the pet is waiting, for example "Pet waiting: you are playing; it collects in your pauses."

The pet status line under Loot → Collection shows how much of the last minute pet pickups held the inventory, for example "Inventory held by pet pickups: 12% of the last minute." To see each pickup, turn on **detailed capture (10 minutes)** in the Activity log: every pet pickup then writes "Pet pickup held the inventory for N ms." These numbers stay on your computer; nothing is sent.

## Who picks up what

In **Loot → Who picks up what**, every kind of drop (gold, potions, equipment, elixirs, lucky powders, magic stones, attribute stones, other alchemy items, other items) is set to **Leave on the ground**, **Pickup pet** or **Character**, so the pet and the character can work side by side. The pet collects during fights and fills its own bag; the character walks to the item and uses your bag, so give it only the kinds you want on you, for example potions or pills. **Default collector** decides for kinds you have not set yourself and for names under **Always include**. One pickup runs at a time; the pet's drops go first. **Finish the current fight before picking up** applies to the character only.

## Walking around obstacles

While chasing a mob the game walks the character straight at it, so a tree or wall in between stops it dead. Under **Settings → Obstacles** (on by default), when the character has stood still for 2.5 seconds without hurting its target and the game's collision data says the straight line is blocked, the bot walks the planned route around the obstacle until the straight line is clear, then the normal attack takes over. After three detours on one mob it drops that mob for a minute and picks another. To drop a mob it stops walking and releases the target; if the game does not confirm the release, it asks once more, and if the mob still stays selected it is dropped for a minute anyway and hunting goes on. A mob that dies or disappears meanwhile counts as released. It needs the collision data the game loads and works outdoors only; in a dungeon the existing no-damage timeout still applies.

## Anti-stuck

Under **Settings → Anti-stuck**, the bot watches for progress while hunting: a confirmed kill, XP, gold, a pickup, or damage to your target. If nothing happens for the set time (default 3 minutes), it recovers in steps: first it drops the current target, then it walks back to the saved hunting spot and resumes, and after the set number of failed recoveries (default 3) it stops hunting. With **Go to town instead of stopping** on (it needs the town cycle) it makes a town trip instead and stays in town, rather than returning to the spot where nothing worked. Any confirmed gain clears the count. Resting, buffing, looting, shopping, town trips and manual control do not count as stuck.

## SoX alerts

When the bot confirms a pickup of Star, Moon or Sun equipment, it shows the item name and tier and plays a short chime. **Loot → Collection** has one switch per seal: **Chime and notice when Star gear is picked up**, and the same for **Moon** and **Sun** (all three on by default). The chime and notice come only for the ticked seals; untick all three to turn them off. **Test SoX chime** previews the sound. To hear a sound of your own instead, press **Choose SoX sound…** and pick an audio file of at most 1 MB (mp3, wav, ogg or m4a). The bot checks that the browser can play it, shows its name, and plays it for every ticked seal instead of the built-in chime; **Clear SoX sound** goes back to the chime. The file is kept only in this browser's local storage, never sent anywhere, and is not part of your settings, share codes or backups, so it does not follow you to another browser or computer. A saved file that the browser can no longer play is dropped and the chime returns. Settings from earlier versions that had the single SoX chime switch on get all three ticked, and those that had it off get none. The count also appears under Session stats. It needs the item catalogue, which loads automatically when hunting starts, and it only announces bot pickups.

## Alert sounds

Under **Loot → Alert sounds**, each switch turns on a short chime, all off by default: **another player comes near** (the same detection the player alert uses), **the character dies**, **a level up**, and **a unique monster coming into view**. The unique hunt has its own kill chime, on by default (see Unique hunt). A click anywhere in the game unlocks the sound after the browser blocked it; the pet and SoX chime buttons preview the sound.

## Session stats

Open **Settings → Session stats** for hunting time, XP/hour, net gold, confirmed kills, deaths, potion use, pickups, SoX found and uniques killed by the unique hunt. Totals pause when hunting stops and stay across toggles. **Reset session**, reloading or changing character clears them. Stats stay local to the page.

## Map

The **Map** page draws the game's minimap around you with your hunt radius (yellow circle, or the polygon below) and chase distance (dashed ring), and shows you, monsters, party members (also ones out of sight, at the edge), other players, NPCs and pets. Click the map to mark a point and press **Make this the hunting spot** to hunt there; the point uses your current height, as the game's own map does. Under the map, **Hunting area** also takes outdoor **X** / **Y** coordinates in whole metres: **Set spot** saves them as the hunting spot, **Set actual position** saves where you stand, and **Get position** and **Copy** show and copy your current coordinates without changing the spot. Drag to look around, use **+** and **−** or the mouse wheel to zoom, and **Follow me** to centre on yourself again. Hunt radius and chase distance can be changed under the map. Dungeons have no map yet.

### Polygon hunting area

A circle around the hunting spot can take in a cliff, a river or a neighbouring spawn. Draw the area as a polygon instead, under the map in **Polygon hunting area**:

- **Add corner here** adds the position of your character as the next corner.
- Click the map to mark a point, then press **Add as corner**. With **Map clicks add corners** ticked, every click adds a corner straight away (this switch is not saved).
- **Remove last corner** takes back the last corner; **Clear corners** removes them all.
- Tick **Use a polygon area** (off by default; the same switch is under **Combat → Hunting area**). The map fills the polygon in yellow and numbers its corners; the hunt radius circle is no longer drawn.

A polygon needs 3 to 32 corners, its edges must not cross, and in a dungeon all corners must be in the same area. Otherwise the map draws it with a red dashed outline, the line under the buttons says what is wrong, and the hunt radius circle is used. Corners may lie in different map regions.

With the polygon in use, everything that means "inside the hunting area" uses it: which monsters are attacked, Protect party members, the "too far" count in the status and bug report, the lure's "monsters at the spot", loot (a drop is picked up inside the polygon or within the pickup radius of its edge), **Return when idle** (the character walks back to the hunting spot only when it is outside the polygon, not when it is merely away from the spot), whether a death or a revive happened inside the area, and whether the party leader is back near the area. **Chase distance** keeps its meaning: how far the character may follow a monster from where it stands.

The hunting spot stays the place the bot walks back to. If the spot is outside the polygon, the line under the buttons and the log warn you, and walking back still goes to the spot. Some things keep the circle because they move the hunting spot away from the corners or are fixed distances: **Spot by level** and zero-setup leveling spots (the circle is used while either is on), hunting around a followed party member, the unique hunt, the town trip's arrival check, and the "near enough to just start hunting" checks after a revive or reconnect.

The corners are saved with the hunting spot per character and are kept in the full settings file (**Export full backup**). Like the hunting spot, they are personal: a share code leaves them out, and an import keeps your own corners. Old settings, share codes and backups load with the polygon off and no corners.

## Wide window

Click **Wide** at the top of the panel for a wider window: a status strip with HP, MP and EXP bars and what the bot is doing, the pages as a list on the left, session numbers and supplies always on the right, and the activity log along the bottom. The pages hold the same settings as in the compact window, in two columns. **Compact** switches back; the compact window is the default. The choice is remembered, and screens narrower than 900 pixels always get the compact window.

## Classic window

Click **Classic** at the top of the panel (screens at least 900 px wide) for a fixed-size window laid out like SBot: a menu bar (Settings, Lists, Help), HP, MP and EXP bars with the bot status beside them, three wide buttons (Start / stop, Return & hunt, Stop all), the tabs down the left, and your session numbers, supplies and **Start training / Stop training** always on the right. The tabs are Settings, Skills, Items/Storage, Stall, Training place, Party/Autores, Player buffing, Auto alchemy and Extra, then Map, Wardrobe and Setup. They hold the same settings as the compact and wide pages, regrouped under SBot's headings, so a change made in one window shows in the others. SBot tabs for things the bot cannot do yet (Chat, Union Party, Auto quest, Other players, Alarms) are not shown. **Compact** brings the small window back; a narrow screen always shows the compact window.

## Minimised panel

The **×** at the top right of the panel, or **F6**, minimises it to a small icon, so it stays out of the way while the bot keeps running. Its dot shows the state: green while hunting, yellow during a town trip, walk back, alchemy or reconnect, and red when stopped, dead or in error. Hover the icon for the current status, HP and MP. It glows when something needs you (a warning, a SoX pickup or a death) until you hover it or open the panel. Drag it anywhere; it keeps its spot and stays minimised after a reload. The panel itself also reopens where you last dragged it. Click it or press **F6** or **F7** to bring the panel back.

## Controls

| Control | Action |
| --- | --- |
| **F8** | Start or stop the bot |
| **×** (top right) | Minimise the panel to a small icon; the bot keeps running |
| **F6** | Minimise the panel to a small icon, or bring it back; also shows a panel hidden with Shift+F7 |
| **F7** | Fold or unfold the panel; brings a minimised panel back |
| **Shift+F7** | Hide or show the panel; the bot keeps running |
| **Return & hunt** | Walk to the saved hunting spot, then start hunting |
| **Stop all** | Cancel hunting and automated trips; potion use has its own switch |

## Long walks are checked against the game map (beta)

A long walk back follows a corridor from the converted route data, which was made from another map and is wrong in places (a slope it climbs can be a cliff here). Before walking it, the bot asks the game for the collision of each region on the way, the same data the game loads when you get there, and walks every step of the corridor with the game's own movement rules. A step that does not walk is left out and the corridor is planned again around it, so the walk takes a way that exists, for example round the rim from Hotan to the Karakoram aircraft dock instead of through the crater. While it checks, the status says so and the character waits; a long corridor takes a few seconds to a minute, and the check runs in longer slices while the character only stands and waits. A corridor that walked is remembered for the session, so the next trip along the same way does not check it again. On the way, a corridor point the character cannot stand on (a rock edge) is passed close by or skipped. If the game's asset loader was not seen (the bot attached after the game started), the corridor is walked unchecked, as before.

## Teleports and ferries on the way back (beta)

When the hunting spot cannot be reached on foot from where the character stands (across a river, or between parts of the map with no walking connection), walking back uses the game's teleporters and ferries, the same ones you would click. Hotan to the western bank, for example, walks to the ferry on the Hotan side, pays its fee, crosses, and walks on to the spot. The bot picks the cheapest mix of walking and hops it can afford, selects the teleporter, waits for its menu and asks for the destination, exactly as the menu does. A teleporter that refuses (not enough gold, level too low, a trade cart) is left out and another way is tried; with no other way the walk stops and says why. A world change other than the hop itself, manual control, Stop or F8 ends the trip. Switch it off with **Walking back may use teleports and ferries (beta)** under **Combat → Hunting area**; then such a walk stops as before. The bot stops about 15 m from the teleporter, within talking range, because many stand on a dock or a ship.

A river can also lie inside one stretch of route data, so a spot on the far bank looks walkable while the only walk goes a long way round, or nowhere. Before it walks, the bot now measures the real walk through the route data from both ends and compares it with the ferries and teleports. If a ferry or teleport is cheaper, it takes that instead, and the log says "Route: the walk is N m the long way round; taking a ferry or teleport instead" (or "no walk reaches it"). A fee counts against the walk at 5 game units of walking per gold coin, because a hop is paid again on every town trip: a cheap ferry wins over an expensive statue teleport. Other walks to a place (a trade merchant, a quest NPC, a unique spot) use the same choice and keep their own arrival and failure handling. Auto trade keeps walking with its transport, which no teleport or ferry takes.

Both are beta: they were tested on the Hotan to Karakoram aircraft dock route. If a walk takes an odd way, send the log; the **Route check** and **Travel** lines show what was checked and used.

## If a town trip stalls on the way to a merchant

The main panel's status line and Send bug report now name what the walk is waiting for, for example "Town movement to the potion merchant: waiting; retrying collision route. No walkable route found through the loaded collision map." The bot never walks blindly through obstacles, so it keeps retrying until the route works or you press F8.

Before it retries, three things happen on their own. If the character stands where the collision map has no way out (on a blocked tile or right against a wall, which can happen after logging in), it first takes a short step to the nearest open ground that is not behind a wall. If a walk to a service finds no route or cannot get around an obstacle, it walks to the town start (the saved arrival point, where the return scroll lands) once and tries the service again from there. If the saved standing point itself is blocked (inside a forge or behind a fence), it tries up to six other spots around the merchant, 3 to 9 m from it, nearest to the way in first, and skips spots the collision map shows as blocked. The log says "blocked, trying another spot beside the merchant". The first spot that gets the character to the merchant replaces the saved one for the next trips, and the trip carries on. Only when every spot fails does the old rule apply: a blocked warehouse is skipped, any other blocked service stops the trip.

- **"Waiting for game collision data" / "Waiting for collision coverage":** the game has not given the bot a collision map for the town you arrived in. Reload the game and try again.
- **"No walkable route found":** save that service point again from open ground a few steps in front of the NPC (stop hunting, stand there, select the NPC and click its Save button).
- **"Blocked route (no progress for 20 s)":** something is physically in the way; check the character is not stuck behind another player or object.

## If a sale, purchase or deposit gets no answer

Sometimes the game never answers a sale, purchase or warehouse move, or the result does not show up in the bag within 15 seconds. The game's replies carry no request number, so the bot never sends the same command again: a late answer could sell or buy twice. Instead it continues in four steps:

1. It waits for the game to finish the inventory action. The status line says "waiting for the game to finish the last inventory action".
2. It closes the open shop or warehouse window.
3. It starts that service again (the warehouse, the potion merchant or the repair merchant) from what the bag and the pet hold now. An item that was already sold is not offered again, and potions are bought only up to the refill target. An item whose deposit did not happen is deposited first.
4. If the game is still busy after a minute, the bot reloads the page, and the reconnect enters the world again. With **Revive in town and go back to the hunting spot** on, it then does the town services from where the character stands. With it off, it resumes hunting as after any reconnect. The bot reloads for this at most once in 30 minutes: if the game hangs again within that time, the trip stops.

The second time this happens in the same trip, the trip stops with "Town cycle stopped: Inventory transaction timed out. No repeat command sent." In that case, reload the game and check the bag before hunting again. An error the game reports still stops the trip at once, as before. The one exception is a sale the merchant refuses: that item is kept and the rest is sold.

## Sharing and importing settings

Under **Settings → Share and import settings**, **Copy share code** or **Save share file** makes a short code or a file holding only the settings you changed from the defaults, ready to post in a GitHub issue or discussion. Codes and files made by the previous bot import too. A share never contains your hunting spot, town and merchant points, walking routes, buff weapon sets or wardrobe, so it works on any character. To import, paste a code or **Open file…** and press **Preview import**: it lists exactly which settings would change and nothing happens until you press **Apply import**. Your own positions, town points, buff weapon sets and wardrobe are kept, and **Undo last import** brings your previous settings back. Files that are not a share, contain unsafe keys or are too large are refused. **Export full backup (with my positions)** saves everything, including your positions, for your own use.

## If something gets stuck

Read the return status on the main panel. Use **Settings → Send bug report**; the diagnostics it previews include recent return states, even after toggling the bot. Reloading clears that history.

After an update, reload the game and check the version shown in the panel.

## License

GNU General Public License v2.0 or later. See [LICENSE](../LICENSE) and the [README](../README.md#credits-and-license). You may use, change and share it, but a version you share has to stay under the same license with its source available.

## Obstacle pursuit and escape recovery

Version 1.2.101 checks blocked approaches before repeating attacks, keeps detour movement exclusive, and abandons unreachable enemies with bounded retries. Escape requires collision-checked destinations and fresh movement confirmation. Under Settings, optional recovery recall and detailed local diagnostics both default off. Recovery recall completes town services and stops in town instead of reversing into the trap. See [OBSTACLE-RECOVERY.md](../OBSTACLE-RECOVERY.md) for behavior, limits and validation commands.

### 1.2.102 targeting correction

The 1.2.101 preflight was too aggressive on sloped terrain. Version 1.2.102 removes the horizontal planner's height cutoff and requires observed native approach failure before abandoning an initially unrouteable target. Missing coverage and exhausted searches keep normal targeting active; failure memory never excludes a different nearby monster.
