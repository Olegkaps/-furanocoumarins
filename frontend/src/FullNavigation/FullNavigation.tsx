import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CircleInfo,
  ClockArrowRotateLeft,
  Database,
  Magnifier,
} from "@gravity-ui/icons";

function NavIcon({
  to,
  left,
  title,
  current,
  children,
}: {
  to: string;
  left: string;
  title: string;
  current?: boolean;
  children: ReactNode;
}) {
  const style = { left };
  if (current) {
    return (
      <span
        className="nav-icon-link is-current"
        style={style}
        title={title}
        aria-label={title}
        aria-current="page"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      to={to}
      target="_blank"
      className="nav-icon-link"
      style={style}
      title={title}
      aria-label={title}
    >
      {children}
    </Link>
  );
}

export interface FullNavigationProps {
  /** Mark this page’s icon as selected and non-clickable */
  pageName?: "home" | "about" | "history" | "cache";
}

export default function FullNavigation({ pageName }: FullNavigationProps) {
  return (
    <>
      <NavIcon
        to="/search"
        left="12px"
        title="Search"
        current={pageName === "home"}
      >
        <Magnifier width={28} height={28} />
      </NavIcon>
      <NavIcon
        to="/about"
        left="64px"
        title="About"
        current={pageName === "about"}
      >
        <CircleInfo width={28} height={28} />
      </NavIcon>
      <NavIcon
        to="/history"
        left="116px"
        title="Query history"
        current={pageName === "history"}
      >
        <ClockArrowRotateLeft width={28} height={28} />
      </NavIcon>
      <NavIcon
        to="/cache"
        left="168px"
        title="API cache"
        current={pageName === "cache"}
      >
        <Database width={28} height={28} />
      </NavIcon>
    </>
  );
}
