import { Link } from "react-router-dom";
import { CircleInfo, ClockArrowRotateLeft, Magnifier } from "@gravity-ui/icons";

function HomeLink() {
  return (
    <Link
      to="/search"
      target="_blank"
      className="nav-icon-link"
      style={{ left: "12px" }}
      title="Search"
      aria-label="Search"
    >
      <Magnifier width={28} height={28} />
    </Link>
  );
}

function AboutLink() {
  return (
    <Link
      to="/about"
      target="_blank"
      className="nav-icon-link"
      style={{ left: "64px" }}
      title="About"
      aria-label="About"
    >
      <CircleInfo width={28} height={28} />
    </Link>
  );
}

function HistoryLink() {
  return (
    <Link
      to="/history"
      target="_blank"
      className="nav-icon-link"
      style={{ left: "116px" }}
      title="Query history"
      aria-label="Query history"
    >
      <ClockArrowRotateLeft width={28} height={28} />
    </Link>
  );
}

export interface FullNavigationProps {
  /** Hide the navigation element for this page (e.g. "about" hides the About link on the About page) */
  pageName?: "home" | "about" | "history";
}

export default function FullNavigation({ pageName }: FullNavigationProps) {
  return (
    <>
      {pageName !== "home" && <HomeLink />}
      {pageName !== "about" && <AboutLink />}
      {pageName !== "history" && <HistoryLink />}
    </>
  );
}
