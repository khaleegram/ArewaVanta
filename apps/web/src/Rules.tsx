import { Shell } from "./PublicCompetitions";
import { Icon } from "./ui";
import { pageMetadata, usePageSeo } from "./seo";
import "./rules.css";

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
  {
    title: "Classes",
    items: ["Ravager Launcher", "Trap Master", "Igniter", "Shock Wave", "Defender"],
  },
];

export default function Rules() {
  usePageSeo(pageMetadata.rules);
  return <Shell>
    <div className="rules-page">
      <header className="rules-intro">
        <p>AREWAVANTA · BATTLE ROYALE</p>
        <h1>Scrim rules<span>.</span></h1>
        <p>A quick guide to what’s banned in our scrims.</p>
      </header>
      <div className="rules-allowed"><Icon name="check" /><strong>Shotguns are allowed.</strong></div>
      <div className="rules-groups">
        {restrictions.map((group) => <section className="rules-group" key={group.title} aria-label={`Banned ${group.title.toLowerCase()}`}>
          <h2>{group.title}</h2>
          <ul>{group.items.map((item) => <li key={item}><span>{item}</span><small>Banned</small></li>)}</ul>
        </section>)}
      </div>
    </div>
  </Shell>;
}
