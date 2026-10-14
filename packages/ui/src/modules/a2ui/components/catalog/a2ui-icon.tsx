import {
  Add,
  ArrowLeft,
  ArrowRight,
  Attachment,
  Calendar,
  Camera,
  type CarbonIconType,
  Checkmark,
  Close,
  Download,
  Edit,
  Email,
  ErrorFilled,
  Event,
  Favorite,
  FavoriteFilled,
  Folder,
  Forward_10,
  Help,
  Home,
  Image,
  Information,
  Location,
  Locked,
  Menu,
  Notification,
  NotificationOff,
  OverflowMenuHorizontal,
  OverflowMenuVertical,
  Pause,
  Phone,
  Play,
  Printer,
  Purchase,
  Renew,
  Rewind_10,
  Search,
  Send,
  Settings,
  Share,
  ShoppingCart,
  SkipBack,
  SkipForward,
  Star,
  StarFilled,
  StarHalf,
  StopFilled,
  TrashCan,
  Unlocked,
  Upload,
  User,
  UserAvatar,
  View,
  ViewOff,
  VolumeDown,
  VolumeMute,
  VolumeUp,
  WarningAlt,
} from "@carbon/icons-react";

import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { ICON_NAMES, type IconName } from "../../lib/icon-names.js";
import type { IconComponent } from "../../lib/schema.js";

const ICONS: Record<IconName, CarbonIconType> = {
  accountCircle: UserAvatar,
  add: Add,
  arrowBack: ArrowLeft,
  arrowForward: ArrowRight,
  attachFile: Attachment,
  calendarToday: Calendar,
  call: Phone,
  camera: Camera,
  check: Checkmark,
  close: Close,
  delete: TrashCan,
  download: Download,
  edit: Edit,
  event: Event,
  error: ErrorFilled,
  fastForward: Forward_10,
  favorite: FavoriteFilled,
  favoriteOff: Favorite,
  folder: Folder,
  help: Help,
  home: Home,
  info: Information,
  locationOn: Location,
  lock: Locked,
  lockOpen: Unlocked,
  mail: Email,
  menu: Menu,
  moreVert: OverflowMenuVertical,
  moreHoriz: OverflowMenuHorizontal,
  notificationsOff: NotificationOff,
  notifications: Notification,
  pause: Pause,
  payment: Purchase,
  person: User,
  phone: Phone,
  photo: Image,
  play: Play,
  print: Printer,
  refresh: Renew,
  rewind: Rewind_10,
  search: Search,
  send: Send,
  settings: Settings,
  share: Share,
  shoppingCart: ShoppingCart,
  skipNext: SkipForward,
  skipPrevious: SkipBack,
  star: StarFilled,
  starHalf: StarHalf,
  starOff: Star,
  stop: StopFilled,
  upload: Upload,
  visibility: View,
  visibilityOff: ViewOff,
  volumeDown: VolumeDown,
  volumeMute: VolumeMute,
  volumeOff: VolumeMute,
  volumeUp: VolumeUp,
  warning: WarningAlt,
};

function isIconName(name: string): name is IconName {
  return (ICON_NAMES as readonly string[]).includes(name);
}

interface Props {
  component: IconComponent;
}

export function A2uiIcon({ component }: Props) {
  const bindings = useA2uiBindings();
  const { name } = component;
  if (typeof name === "object" && "svgPath" in name) {
    const path = bindings.text(name.svgPath);
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="size-4 shrink-0 fill-current"
      >
        <path d={path} />
      </svg>
    );
  }
  const resolved = typeof name === "string" ? name : bindings.text(name);
  if (!isIconName(resolved)) return null;
  const Icon = ICONS[resolved];
  return <Icon size={16} aria-hidden className="shrink-0" />;
}
