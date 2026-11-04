import { BriefcaseIcon, CrosshairIcon, FlaskIcon, GalleryIcon, HelpCircleIcon, ListIcon, SearchIcon, StarIcon, TapeIcon } from "@/components/Icons";
import type { NavKey } from "@/lib/nav";

/** One icon per section of the top bar (lib/nav.ts), shared by the bar and the picker. */
export const NAV_ICONS: Record<NavKey, typeof ListIcon> = {
  deck: ListIcon,
  paper: BriefcaseIcon,
  gallery: GalleryIcon,
  research: FlaskIcon,
  tape: TapeIcon,
  watchlist: StarIcon,
  sim: CrosshairIcon,
  lookup: SearchIcon,
  help: HelpCircleIcon,
};
