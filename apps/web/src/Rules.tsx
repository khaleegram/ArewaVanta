import { useEffect, useState } from "react";
import { Shell } from "./PublicCompetitions";
import { Icon } from "./ui";
import { pageMetadata, usePageSeo } from "./seo";
import "./rules.css";

const allowedClasses = [
  "Rewind",
  "Trickster",
  "Ninja",
  "Medic",
  "Defender",
  "Pump",
];
const restrictions = [
  {
    title: "Weapons & attachments",
    items: [
      "SMRS",
      "Thumper",
      "War Machine",
      "Purifier",
      "Tempest",
      "Annihilator",
      "Exotic Arctic .50",
      "Thermite-reload attachments for snipers and marksman rifles",
    ],
  },
  {
    title: "Vehicles",
    items: ["Tanks", "Jackal jets", "Hoverbikes", "Cargo trucks"],
  },
];
const tabs = [
  { id: "game-rules", label: "Game rules" },
  { id: "punishments", label: "Punishments" },
  { id: "slot-rules", label: "Slot rules" },
] as const;
type Tab = (typeof tabs)[number]["id"];
function currentTab(): Tab {
  return (
    tabs.find((tab) => `#${tab.id}` === window.location.hash)?.id ??
    "game-rules"
  );
}

export default function Rules() {
  usePageSeo(pageMetadata.rules);
  const [active, setActive] = useState<Tab>(currentTab);
  useEffect(() => {
    const update = () => setActive(currentTab());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  function selectTab(id: Tab) {
    setActive(id);
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, "", url);
  }
  return (
    <Shell>
      <div className="rules-page">
        <header className="rules-intro">
          <p>AREWAVANTA · BATTLE ROYALE</p>
          <h1>
            Scrim rules<span>.</span>
          </h1>
          <p>Know what’s allowed, play fair and stay in your slot.</p>
        </header>
        <div
          className="rules-tabs"
          role="tablist"
          aria-label="Scrim rules sections"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`rules-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              aria-controls={`rules-panel-${tab.id}`}
              tabIndex={active === tab.id ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          tabs.length) %
                        tabs.length;
                selectTab(tabs[next].id);
                document.getElementById(`rules-tab-${tabs[next].id}`)?.focus();
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <section
          id="rules-panel-game-rules"
          className="rules-panel"
          role="tabpanel"
          aria-labelledby="rules-tab-game-rules"
          tabIndex={0}
          hidden={active !== "game-rules"}
        >
          <section
            className="rules-classes"
            aria-labelledby="allowed-classes-title"
          >
            <div className="rules-section-heading">
              <h2 id="allowed-classes-title">Only 6 classes allowed</h2>
              <span>All other classes are banned</span>
            </div>
            <ul>
              {allowedClasses.map((name) => (
                <li key={name}>
                  <Icon name="check" />
                  {name}
                </li>
              ))}
            </ul>
          </section>
          <div className="rules-allowed">
            <Icon name="check" />
            <strong>Shotguns are allowed.</strong>
          </div>
          <div className="rules-groups">
            {restrictions.map((group) => (
              <section
                className="rules-group"
                key={group.title}
                aria-label={`Banned ${group.title.toLowerCase()}`}
              >
                <h2>{group.title}</h2>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>
                      <span>{item}</span>
                      <small>Banned</small>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
        <section
          id="rules-panel-punishments"
          className="rules-panel"
          role="tabpanel"
          aria-labelledby="rules-tab-punishments"
          tabIndex={0}
          hidden={active !== "punishments"}
        >
          <h2 className="rules-panel-title">Reporting & punishments</h2>
          <ol className="rules-policy-list">
            <li>
              <span className="rules-policy-number">01</span>
              <div>
                <h3>Report a violation</h3>
                <p>
                  Screenshot the player’s name and evidence of the banned item
                  or class. Send it to an organizer.
                </p>
              </div>
            </li>
            <li>
              <span className="rules-policy-number">02</span>
              <div>
                <h3>SMRS kills</h3>
                <p>
                  The victim receives the kill points. The offending player
                  receives one warning.
                </p>
              </div>
            </li>
            <li className="rules-policy-penalty">
              <span className="rules-policy-number">03</span>
              <div>
                <h3>3 warnings = 2-week ban</h3>
                <p>
                  A player who receives three warnings is suspended from scrims
                  for two weeks.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section
          id="rules-panel-slot-rules"
          className="rules-panel"
          role="tabpanel"
          aria-labelledby="rules-tab-slot-rules"
          tabIndex={0}
          hidden={active !== "slot-rules"}
        >
          <h2 className="rules-panel-title">Your team. Your slot.</h2>
          <ol className="rules-policy-list">
            <li>
              <span className="rules-policy-number">01</span>
              <div>
                <h3>Keep your assigned slot</h3>
                <p>
                  Your slot is permanent until an organizer reassigns it.
                  Contact an organizer to request a change.
                </p>
              </div>
            </li>
            <li className="rules-policy-penalty">
              <span className="rules-policy-number">02</span>
              <div>
                <h3>Wrong slot = zero points</h3>
                <p>
                  Playing outside your assigned slot, including in another
                  team’s slot, means no points for your team for that entire
                  game.
                </p>
              </div>
            </li>
            <li>
              <span className="rules-policy-number">03</span>
              <div>
                <h3>Report slot misuse</h3>
                <p>
                  If another team takes your slot, screenshot their names and
                  report it to an organizer.
                </p>
              </div>
            </li>
          </ol>
        </section>
      </div>
    </Shell>
  );
}
