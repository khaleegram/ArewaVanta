import React from "react";
import ReactDOM from "react-dom/client";
import LiveHome from "./LiveHome";
import LiveLeaderboard from "./LiveLeaderboard";
import CompetitionManager from "./CompetitionManager";
import DirectoryManager from "./DirectoryManager";
import ResultManager from "./ResultManager";
import CaptainInvite from "./CaptainInvite";
import CompetitionOrganizerInvite from "./CompetitionOrganizerInvite";
import {
  ForgotPasswordPage,
  ResetPasswordPage,
} from "./PasswordRecovery";
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
import "./light-theme.css";
import "./competition-overview.css";
import "./home-studio.css";
import "./public-detail.css";
import "./competition-listing.css";
import "./public-match.css";
import "./rankings-page.css";
import "./public-people-pages.css";
import { applyPageSeo } from "./seo";

const root = ReactDOM.createRoot(document.getElementById("root")!);

function renderRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const eventMatch = path.match(/^\/competitions\/([^/]+)(?:\/games\/([^/]+))?$/);
  const personMatch = path.match(/^\/(clans|squads|players)\/([^/]+)$/);
  const managerResultsMatch = path.match(/^\/manage\/competitions\/([^/]+)\/results$/);
  const managerEntriesMatch = path.match(/^\/manage\/competitions\/([^/]+)\/entries$/);
  const managerCompetitionMatch = path.match(/^\/manage\/competitions\/([^/]+)$/);
  let page: React.ReactNode;

  if (path === "/leaderboard") page = <LiveLeaderboard />;
  else if (managerResultsMatch) page = <ResultManager eventId={decodeURIComponent(managerResultsMatch[1])} />;
  else if (managerEntriesMatch) page = <CompetitionManager entriesEventId={decodeURIComponent(managerEntriesMatch[1])} />;
  else if (managerCompetitionMatch) page = <CompetitionManager workspaceEventId={decodeURIComponent(managerCompetitionMatch[1])} />;
  else if (path === "/manage/competitions") page = <CompetitionManager />;
  else if (path === "/manage/directory") page = <DirectoryManager />;
  else if (path === "/captain-invite") page = <CaptainInvite />;
  else if (path === "/competition-organizer-invite") page = <CompetitionOrganizerInvite />;
  else if (path === "/forgot-password") page = <ForgotPasswordPage />;
  else if (path === "/reset-password") page = <ResetPasswordPage />;
  else if (path === "/competitions") page = <CompetitionListing />;
  else if (path === "/clans") page = <ClanListing />;
  else if (path === "/players") page = <PlayerListing />;
  else if (personMatch) {
    try {
      const id = decodeURIComponent(personMatch[2]);
      page = personMatch[1] === "clans"
        ? <ClanPage slug={id} />
        : personMatch[1] === "squads"
          ? <SquadPage slug={id} />
          : <PlayerPage id={id} />;
    } catch {
      page = <ClanListing />;
    }
  } else if (eventMatch) {
    try {
      const slug = decodeURIComponent(eventMatch[1]);
      page = eventMatch[2]
        ? <MatchPage slug={slug} matchId={decodeURIComponent(eventMatch[2])} />
        : <CompetitionDetail slug={slug} />;
    } catch {
      page = <CompetitionListing />;
    }
  } else if (path === "/") page = <LiveHome />;
  else page = (
    <main style={{ padding: "3rem" }}>
      <h1>Page not found</h1>
      <a href="/">Back to homepage</a>
    </main>
  );

  const privateRoute = path.startsWith("/manage/") || [
    "/captain-invite",
    "/competition-organizer-invite",
    "/forgot-password",
    "/reset-password",
  ].includes(path);
  if (privateRoute) {
    applyPageSeo({
      title: "Account access | ArewaVanta",
      description: "Private ArewaVanta account and competition management.",
      path,
      noIndex: true,
    });
  } else if (![
    "/",
    "/leaderboard",
    "/competitions",
    "/clans",
    "/players",
  ].includes(path) && !eventMatch && !personMatch) {
    applyPageSeo({
      title: "Page not found | ArewaVanta",
      description: "This ArewaVanta page could not be found.",
      path,
      noIndex: true,
    });
  }

  root.render(
    <React.StrictMode>
      <React.Fragment key={`${window.location.pathname}${window.location.search}`}>
        {page}
      </React.Fragment>
    </React.StrictMode>,
  );
}

function handleInternalNavigation(event: MouseEvent) {
  if (
    event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
    event.shiftKey || event.altKey
  ) return;

  const source = event.target;
  const anchor = source instanceof Element ? source.closest("a") : null;
  if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;

  const destination = new URL(anchor.href, window.location.href);
  if (destination.origin !== window.location.origin) return;

  const current = new URL(window.location.href);
  if (destination.pathname === current.pathname && destination.search === current.search) {
    if (destination.hash) return;
    event.preventDefault();
    return;
  }

  event.preventDefault();
  window.history.pushState(null, "", `${destination.pathname}${destination.search}${destination.hash}`);
  renderRoute();
  if (destination.hash) {
    requestAnimationFrame(() => {
      const id = decodeURIComponent(destination.hash.slice(1));
      const target = document.getElementById(id);
      const previousBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";
      target?.scrollIntoView();
      requestAnimationFrame(() => {
        document.documentElement.style.scrollBehavior = previousBehavior;
      });
    });
  } else {
    const previousBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = previousBehavior;
    });
  }
}

document.addEventListener("click", handleInternalNavigation);
window.addEventListener("popstate", renderRoute);
renderRoute();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    document.removeEventListener("click", handleInternalNavigation);
    window.removeEventListener("popstate", renderRoute);
  });
}
