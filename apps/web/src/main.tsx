import React from "react";
import ReactDOM from "react-dom/client";
import LiveHome from "./LiveHome";
import LiveLeaderboard from "./LiveLeaderboard";
import CompetitionManager from "./CompetitionManager";
import DirectoryManager from "./DirectoryManager";
import CaptainInvite from "./CaptainInvite";
import {
  CompetitionListing,
  CompetitionDetail,
  MatchPage,
} from "./PublicCompetitions";
import {
  ClanListing,
  ClanPage,
  SquadPage,
  PlayerListing,
  PlayerPage,
} from "./PublicPeople";
import "./styles.css";
import "./home.css";
import "./live-home.css";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
const eventMatch = path.match(/^\/competitions\/([^/]+)(?:\/games\/([^/]+))?$/);
const personMatch = path.match(/^\/(clans|squads|players)\/([^/]+)$/);
let page: React.ReactNode;
if (path === "/leaderboard") page = <LiveLeaderboard />;
else if (path === "/manage/competitions") page = <CompetitionManager />;
else if (path === "/manage/directory") page = <DirectoryManager />;
else if (path === "/captain-invite") page = <CaptainInvite />;
else if (path === "/competitions") page = <CompetitionListing />;
else if (path === "/clans") page = <ClanListing />;
else if (path === "/players") page = <PlayerListing />;
else if (personMatch) {
  try {
    const id = decodeURIComponent(personMatch[2]);
    page =
      personMatch[1] === "clans" ? (
        <ClanPage slug={id} />
      ) : personMatch[1] === "squads" ? (
        <SquadPage slug={id} />
      ) : (
        <PlayerPage id={id} />
      );
  } catch {
    page = <ClanListing />;
  }
} else if (eventMatch) {
  try {
    const slug = decodeURIComponent(eventMatch[1]);
    page = eventMatch[2] ? (
      <MatchPage slug={slug} matchId={decodeURIComponent(eventMatch[2])} />
    ) : (
      <CompetitionDetail slug={slug} />
    );
  } catch {
    page = <CompetitionListing />;
  }
} else if (path === "/") page = <LiveHome />;
else
  page = (
    <main style={{ padding: "3rem" }}>
      <h1>Page not found</h1>
      <a href="/">Back to homepage</a>
    </main>
  );

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{page}</React.StrictMode>,
);
