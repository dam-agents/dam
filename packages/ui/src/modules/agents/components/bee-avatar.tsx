import { cn } from "@/lib/utils";

export interface BeeColors {
  eyes: string;
  body: string;
  wings: string;
}

type FillArg = string | BeeColors;

function f(colors: FillArg, part: "eyes" | "body" | "wings"): string {
  return typeof colors === "string" ? colors : colors[part];
}

type BeeRenderer = (fill: FillArg) => React.ReactNode;

export const BEE_NAMES = [
  "signal",
  "cross",
  "crown",
  "shield",
  "bloom",
  "tower",
  "tilt",
] as const;

const bees: BeeRenderer[] = [
  // signal (viewBox 112×112)
  (fill) => (
    <svg viewBox="0 0 112 112" overflow="visible" fill="none">
      <path
        d="M35.2472 110.716C31.934 112.073 28.062 112.153 24.5092 110.636C20.9565 109.119 18.3219 106.325 16.9647 102.972C16.2861 101.255 15.9268 99.4991 15.9268 97.7427C15.9268 95.9064 16.2861 94.0303 17.0446 92.234C18.4417 88.9208 21.1162 86.1265 24.6689 84.6894L56.0845 71.9156L42.9115 103.172C41.3946 106.724 38.6003 109.359 35.2472 110.716Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M77.4808 27.3992L45.227 16.9406L75.445 1.53224C78.878 -0.224153 82.75 -0.423744 86.143 0.693963C88.0192 1.29273 89.6558 2.25077 91.053 3.44831C92.3703 4.60594 93.488 6.00307 94.3263 7.63971C95.9629 10.8332 96.3621 14.6653 95.1645 18.3378C93.967 22.0102 91.3723 24.8843 88.1789 26.521C84.9854 28.1576 81.1533 28.5568 77.4808 27.3593V27.3992Z"
        fill={f(fill, "wings")}
      />
      <g className="bee-eyes-sleep">
        <path d="M0,53.86 A7.98,7.98 0 0 0 15.97,53.86" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
        <path d="M0.2,30 A7.9,7.9 0 0 0 16.01,30" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
        <path d="M95.88,77.81 A7.98,7.98 0 0 0 111.85,77.81" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
        <path d="M96.04,53.95 A7.9,7.9 0 0 0 111.85,53.95" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
      </g>
      <g className="bee-eyes-wake">
        <path d="M15.9672 53.8554C15.9672 49.4245 12.4145 45.8718 7.98362 45.8718C3.55271 45.8718 0 49.4245 0 53.8554C0 58.2864 3.55271 61.8391 7.98362 61.8391C12.4145 61.8391 15.9672 58.2864 15.9672 53.8554Z" fill={f(fill, "eyes")} />
        <path d="M15.9673 29.9984C15.9673 25.6473 12.4545 22.0946 8.06354 22.0946C3.67255 22.0946 0.199677 25.6473 0.199677 29.9984C0.199677 34.3495 3.71247 37.9022 8.10346 37.9022C12.4945 37.9022 16.0072 34.3894 16.0072 29.9984H15.9673Z" fill={f(fill, "eyes")} />
        <path d="M111.851 77.8105C111.851 73.3796 108.298 69.8269 103.867 69.8269C99.4361 69.8269 95.8834 73.3796 95.8834 77.8105C95.8834 82.2414 99.4361 85.7941 103.867 85.7941C108.298 85.7941 111.851 82.2414 111.851 77.8105Z" fill={f(fill, "eyes")} />
        <path d="M111.851 53.9497C111.851 49.5986 108.338 46.0459 103.947 46.0459C99.5558 46.0459 96.043 49.5587 96.043 53.9497C96.043 58.3407 99.5558 61.8535 103.947 61.8535C108.338 61.8535 111.851 58.3407 111.851 53.9497Z" fill={f(fill, "eyes")} />
      </g>
      <path
        d="M87.9395 71.7953V55.8281L23.9508 31.9969V47.9642L87.9395 71.7953Z"
        fill={f(fill, "body")}
      />
    </svg>
  ),

  // cross (viewBox 125×125)
  (fill) => (
    <svg viewBox="0 0 125 125" fill="none">
      <g className="bee-eyes-sleep">
        <path d="M42.97,62.34 A7.81,7.81 0 0 0 58.59,62.34" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
        <path d="M66.41,62.34 A7.81,7.81 0 0 0 82.03,62.34" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
      </g>
      <g className="bee-eyes-wake">
        <circle cx="50.7812" cy="62.3438" r="7.8125" fill={f(fill, "eyes")} />
        <circle cx="74.2188" cy="62.3438" r="7.8125" fill={f(fill, "eyes")} />
      </g>
      <path
        d="M15.4297 97.7734V70.2344L34.8828 89.6875C37.1094 91.9141 38.2031 94.8438 38.2031 97.7344C38.2031 99.3359 37.8906 100.82 37.3047 102.227C36.7578 103.516 35.9375 104.766 34.8828 105.82C32.8125 107.891 29.9609 109.141 26.8359 109.141C23.7109 109.141 20.8594 107.852 18.7891 105.781C16.7187 103.711 15.4297 100.859 15.4297 97.7344V97.7734Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M35.2344 35.1562L15.7812 54.6094V27.0703C15.7812 23.9453 17.0703 21.0937 19.1406 19.0234C20.2734 17.8906 21.5625 17.0703 22.9688 16.4844C24.2969 15.9375 25.7031 15.6641 27.2266 15.6641C30.1562 15.6641 33.0469 16.7969 35.2734 18.9844C37.5 21.1719 38.5938 24.1406 38.5938 27.0312C38.5938 29.9219 37.5 32.8516 35.2734 35.0781L35.2344 35.1562Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M109.18 27.1094V54.6484L89.7266 35.1953C87.5 32.9688 86.4062 30.0391 86.4062 27.1484C86.4062 25.5469 86.7187 24.0625 87.3047 22.6562C87.8516 21.3672 88.6719 20.1172 89.7266 19.0625C91.7969 16.9922 94.6484 15.7422 97.7734 15.7422C100.898 15.7422 103.75 17.0312 105.82 19.1016C107.891 21.1719 109.18 24.0234 109.18 27.1484V27.1094Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M89.7266 89.7266L109.18 70.2734V97.8125C109.18 100.938 107.891 103.789 105.82 105.859C104.687 106.992 103.398 107.813 101.992 108.398C100.664 108.945 99.2578 109.219 97.7344 109.219C94.8047 109.219 91.9141 108.086 89.6875 105.898C87.4609 103.711 86.3672 100.742 86.3672 97.8516C86.3672 94.9609 87.4609 92.0313 89.6875 89.8047L89.7266 89.7266Z"
        fill={f(fill, "wings")}
      />
    </svg>
  ),

  // crown (viewBox 125×125)
  (fill) => (
    <svg viewBox="0 0 125 125" fill="none">
      <g className="bee-eyes-sleep">
        <path d="M42.97,42.78 A7.81,7.81 0 0 0 58.59,42.78" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
        <path d="M66.41,42.78 A7.81,7.81 0 0 0 82.03,42.78" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
      </g>
      <g className="bee-eyes-wake">
        <circle cx="50.7814" cy="42.7817" r="7.8125" fill={f(fill, "eyes")} />
        <circle cx="74.2185" cy="42.7817" r="7.8125" fill={f(fill, "eyes")} />
      </g>
      <path
        d="M113.789 23.0151C115.859 25.0854 117.148 27.937 117.148 31.062C117.148 34.187 115.859 37.0386 113.789 39.1089C112.734 40.1636 111.523 40.9839 110.195 41.5308C108.828 42.1167 107.305 42.4292 105.703 42.4292C102.773 42.4292 99.8828 41.2964 97.6562 39.1089L78.2031 19.6558H105.742C108.867 19.6558 111.719 20.9448 113.789 23.0151Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M19.2969 19.6558H46.836L27.3829 39.1089C25.1563 41.3354 22.2266 42.4292 19.336 42.4292C17.7344 42.4292 16.2501 42.1167 14.8438 41.5308C13.5547 40.9839 12.3047 40.1636 11.2501 39.1089C9.17975 37.0386 7.89069 34.187 7.89069 31.062C7.89069 27.937 9.17975 25.0854 11.2501 23.0151C13.3204 20.9448 16.1719 19.6558 19.2969 19.6558Z"
        fill={f(fill, "wings")}
      />
      <rect
        x="35.1561"
        y="66.1349"
        width="54.688"
        height="15.625"
        fill={f(fill, "body")}
      />
      <rect
        x="35.1561"
        y="89.6942"
        width="54.688"
        height="15.625"
        fill={f(fill, "body")}
      />
    </svg>
  ),

  // shield (viewBox 125×125)
  (fill) => (
    <svg viewBox="0 0 125 125" fill="none">
      <g className="bee-eyes-sleep">
        <path d="M66.6,31.06 A7.82,7.82 0 0 0 82.23,31.06" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
        <path d="M43.24,31.14 A7.77,7.77 0 0 0 58.79,31.14" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
      </g>
      <g className="bee-eyes-wake">
        <circle cx="74.4144" cy="31.0586" r="7.8125" fill={f(fill, "eyes")} />
        <circle cx="51.055" cy="31.1355" r="7.8125" fill={f(fill, "eyes")} />
      </g>
      <rect
        x="43.1644"
        y="46.8004"
        width="39.101"
        height="15.625"
        fill={f(fill, "body")}
      />
      <rect x="43.1253" y="70.238" width="39.101" height="15.625" fill={f(fill, "body")} />
      <rect
        x="43.1253"
        y="93.6758"
        width="39.101"
        height="15.625"
        fill={f(fill, "body")}
      />
      <path
        d="M7.73483 29.1436C7.73483 25.6279 9.06296 22.1123 11.7583 19.417C14.4536 16.7217 17.9692 15.3936 21.4848 15.3936C23.2817 15.3936 25.0395 15.7451 26.602 16.3701C28.2817 17.0342 29.8442 18.0498 31.2114 19.417C33.7114 21.917 35.2348 25.3545 35.2348 29.1436V62.3467L11.7583 38.8701C9.06296 36.1748 7.73483 32.6592 7.73483 29.1436Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M113.243 38.8706L90.0005 62.1128V29.2222C90.0005 25.4722 91.5239 22.0737 93.9848 19.6128C95.313 18.2847 96.8755 17.269 98.5161 16.605C100.079 15.98 101.797 15.6284 103.594 15.6284C107.071 15.6284 110.547 16.9565 113.204 19.6128C115.86 22.269 117.188 25.7456 117.188 29.2222C117.188 32.6987 115.86 36.1753 113.204 38.8315L113.243 38.8706Z"
        fill={f(fill, "wings")}
      />
    </svg>
  ),

  // bloom (viewBox 125×125)
  (fill) => (
    <svg viewBox="0 0 125 125" fill="none">
      <g className="bee-eyes-sleep">
        <path d="M66.05,78.55 A7.82,7.82 0 0 0 81.68,78.55" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
        <path d="M42.62,78.55 A7.81,7.81 0 0 0 58.24,78.55" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
      </g>
      <g className="bee-eyes-wake">
        <circle cx="73.8673" cy="78.5464" r="7.8125" fill={f(fill, "eyes")} />
        <circle cx="50.4296" cy="78.5464" r="7.8125" fill={f(fill, "eyes")} />
      </g>
      <path
        d="M97.5389 59.0156H69.9999L89.453 39.5625C91.6796 37.3359 94.6092 36.2422 97.4999 36.2422C99.1014 36.2422 100.586 36.5547 101.992 37.1406C103.281 37.6875 104.531 38.5078 105.586 39.5625C107.656 41.6328 108.945 44.4844 108.945 47.6094C108.945 50.7344 107.656 53.5859 105.586 55.6563C103.516 57.7266 100.664 59.0156 97.5389 59.0156Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M85.0001 35.0703L65.547 54.5234V26.9844C65.547 23.8594 66.8361 21.0078 68.9064 18.9375C70.0392 17.8047 71.3282 16.9844 72.7345 16.3984C74.0626 15.8516 75.4689 15.5781 76.9923 15.5781C79.922 15.5781 82.8126 16.7109 85.0392 18.8984C87.2657 21.0859 88.3595 24.0547 88.3595 26.9453C88.3595 29.8359 87.2657 32.7656 85.0392 34.9922L85.0001 35.0703Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M58.2421 27.5332V55.0723L38.7889 35.6191C36.5624 33.3926 35.4686 30.4629 35.4686 27.5723C35.4686 25.9707 35.7811 24.4863 36.3671 23.0801C36.9139 21.791 37.7343 20.541 38.7889 19.4863C40.8593 17.416 43.7108 16.166 46.8358 16.166C49.9608 16.166 52.8124 17.4551 54.8827 19.5254C56.953 21.5957 58.2421 24.4473 58.2421 27.5723V27.5332Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M34.2969 40.0706L53.7501 59.5237H26.211C23.086 59.5237 20.2344 58.2346 18.1641 56.1643C17.0313 55.0315 16.211 53.7424 15.6641 52.3752C15.1172 51.0471 14.8438 49.6409 14.8438 48.1174C14.8438 45.1877 15.9376 42.2971 18.1641 40.0706C20.3907 37.844 23.3204 36.7502 26.211 36.7502C29.1016 36.7502 32.0313 37.844 34.2579 40.0706H34.2969Z"
        fill={f(fill, "wings")}
      />
      <rect
        x="35.1562"
        y="94.1724"
        width="54.336"
        height="15.625"
        fill={f(fill, "body")}
      />
    </svg>
  ),

  // tower (viewBox 125×125)
  (fill) => (
    <svg viewBox="0 0 125 125" fill="none">
      <g className="bee-eyes-sleep">
        <path d="M66.21,23.37 A7.82,7.82 0 0 0 81.84,23.37" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
        <path d="M42.85,23.44 A7.77,7.77 0 0 0 58.40,23.44" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
      </g>
      <g className="bee-eyes-wake">
        <circle cx="74.0241" cy="23.3693" r="7.8125" fill={f(fill, "eyes")} />
        <circle cx="50.6654" cy="23.4447" r="7.8125" fill={f(fill, "eyes")} />
      </g>
      <rect x="43.008" y="39.0702" width="15.625" height="70.313" fill={f(fill, "body")} />
      <rect
        x="66.4457"
        y="39.0702"
        width="15.625"
        height="70.313"
        fill={f(fill, "body")}
      />
      <path
        d="M31.0949 81.8462C28.5949 84.3462 25.1574 85.8696 21.3684 85.8696C17.5793 85.8696 14.1418 84.3462 11.6418 81.8462C10.3527 80.5571 9.37617 79.1118 8.71211 77.5103C8.00899 75.8696 7.61836 74.0337 7.61836 72.1196C7.61836 68.604 8.94649 65.0884 11.6418 62.3931L35.1184 38.9165V72.1196C35.1184 75.9087 33.5949 79.3462 31.0949 81.8462Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M117.07 71.9218C117.07 75.3983 115.742 78.8749 113.086 81.5311C110.43 84.1874 106.953 85.5155 103.476 85.5155C101.68 85.5155 99.9608 85.1639 98.3983 84.5389C96.7577 83.8749 95.1952 82.8593 93.8671 81.5311C91.4062 79.0702 89.8827 75.6718 89.8827 71.9218V39.0702L113.125 62.3124C115.781 64.9686 117.109 68.4452 117.109 71.9218H117.07Z"
        fill={f(fill, "wings")}
      />
    </svg>
  ),

  // tilt (viewBox 125×125)
  (fill) => (
    <svg viewBox="0 0 125 125" fill="none">
      <g className="bee-eyes-sleep">
        <path d="M78.1,23.35 A7.81,7.81 0 0 0 93.72,23.35" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
        <path d="M54.78,23.43 A7.77,7.77 0 0 0 70.33,23.43" fill="none" stroke={f(fill, "eyes")} strokeWidth="6" />
      </g>
      <g className="bee-eyes-wake">
        <circle cx="85.9106" cy="23.3539" r="7.8125" fill={f(fill, "eyes")} />
        <circle cx="62.5966" cy="23.4293" r="7.8125" fill={f(fill, "eyes")} />
      </g>
      <path
        d="M39.1662 109.413H23.5461L62.5964 39.1006H78.2165L39.1662 109.413Z"
        fill={f(fill, "body")}
      />
      <path
        d="M113.206 72.1072C113.206 75.5837 111.878 79.0603 109.223 81.7166C106.567 84.3728 103.092 85.7009 99.6162 85.7009C97.8199 85.7009 96.1017 85.3494 94.5397 84.7244C92.8996 84.0603 91.3376 83.0447 90.0099 81.7166C87.5497 79.2556 86.0267 75.8572 86.0267 72.1072V39.2556L109.262 62.4978C111.917 65.1541 113.245 68.6306 113.245 72.1072H113.206Z"
        fill={f(fill, "wings")}
      />
      <path
        d="M21.3993 39.0548H54.2406L31.0056 62.297C28.3502 64.9533 24.8748 66.2814 21.3993 66.2814C19.4858 66.2814 17.6895 65.8908 16.0494 65.1876C14.4874 64.5236 13.0425 63.547 11.7539 62.297C9.29368 59.8361 7.77072 56.4376 7.77072 52.6876C7.77072 48.9376 9.29368 45.5392 11.7539 43.0782C14.214 40.6173 17.6114 39.0939 21.3602 39.0939L21.3993 39.0548Z"
        fill={f(fill, "wings")}
      />
    </svg>
  ),
];

const SLEEPING_STATES = new Set(["hibernated", "hibernating"]);

function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) % bees.length;
}

const BEE_STYLES = `
/* ── Keyframes (same as design sheet) ── */
@keyframes bee-blink {
  0%, 30%, 100% { transform: scaleY(1); }
  15% { transform: scaleY(0.05); }
}
@keyframes bee-look-leye {
  0%, 100%  { transform: translate(0, 0) scale(1); }
  25%, 38%  { transform: translate(5px, -3px) scale(1); }
  58%, 72%  { transform: translate(-5px, -3px) scale(1.15); }
}
@keyframes bee-look-reye {
  0%, 100%  { transform: translate(0, 0) scale(1); }
  25%, 38%  { transform: translate(5px, -3px) scale(1.15); }
  58%, 72%  { transform: translate(-5px, -3px) scale(1); }
}
@keyframes bee-flutter-l {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(8deg); }
  55% { transform: rotate(-5deg); }
  80% { transform: rotate(3deg); }
}
@keyframes bee-flutter-r {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-8deg); }
  55% { transform: rotate(5deg); }
  80% { transform: rotate(-3deg); }
}
@keyframes bee-bob {
  0%, 100% { transform: translateY(0); }
  45% { transform: translateY(-7px); }
}
@keyframes bee-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
@keyframes bee-rock {
  0%, 100% { transform: rotate(0deg); }
  35% { transform: rotate(var(--br, 6deg)); }
  70% { transform: rotate(calc(var(--br, 6deg) * -0.6)); }
}
@keyframes bee-twitch {
  0%, 92%, 100% { transform: rotate(0deg); }
  93% { transform: rotate(14deg); }
  95% { transform: rotate(-8deg); }
  96.5% { transform: rotate(5deg); }
  97.5% { transform: rotate(0deg); }
}
@keyframes bee-breathe {
  0% { transform: scaleY(1); }
  50% { transform: scaleY(0.88); }
  100% { transform: scaleY(1); }
}

/* ── Eye transform setup ── */
.bee-avatar .bee-eyes-wake > * {
  transform-box: fill-box;
  transform-origin: center;
}

/* ── Eye visibility by state ── */
.bee-awake .bee-eyes-sleep { display: none; }
.bee-sleeping .bee-eyes-wake { display: none; }
.bee-idle .bee-eyes-wake { display: none; }
.group:hover .bee-idle .bee-eyes-sleep { display: none; }
.group:hover .bee-idle .bee-eyes-wake { display: block; }

/* ── Awake hover: eye animations per bee type ── */

/* blink: signal */
:is(.bee-awake, .bee-idle)[data-icon="signal"] .bee-eyes-wake > :nth-child(1) { animation: none; }
:is(.bee-awake, .bee-idle)[data-icon="signal"] .bee-eyes-wake > :nth-child(2) { animation: none; }
:is(.bee-awake, .bee-idle)[data-icon="signal"] .bee-eyes-wake > :nth-child(3) { animation: none; }
:is(.bee-awake, .bee-idle)[data-icon="signal"] .bee-eyes-wake > :nth-child(4) { animation: none; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="signal"] .bee-eyes-wake > :nth-child(1) { animation: bee-blink 0.9s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="signal"] .bee-eyes-wake > :nth-child(2) { animation: bee-blink 0.9s ease-in-out 0.08s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="signal"] .bee-eyes-wake > :nth-child(3) { animation: bee-blink 0.9s ease-in-out 0.04s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="signal"] .bee-eyes-wake > :nth-child(4) { animation: bee-blink 0.9s ease-in-out 0.12s; }

/* blink: bloom */
.group:hover :is(.bee-awake, .bee-idle)[data-icon="bloom"] .bee-eyes-wake > :nth-child(1) { animation: bee-blink 0.9s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="bloom"] .bee-eyes-wake > :nth-child(2) { animation: bee-blink 0.9s ease-in-out 0.06s; }

/* look-around (left-eye-first): cross, crown */
.group:hover :is(.bee-awake, .bee-idle):is([data-icon="cross"], [data-icon="crown"]) .bee-eyes-wake > :nth-child(1) { animation: bee-look-leye 1.2s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle):is([data-icon="cross"], [data-icon="crown"]) .bee-eyes-wake > :nth-child(2) { animation: bee-look-reye 1.2s ease-in-out; }

/* look-around (right-eye-first): shield, tilt, tower */
.group:hover :is(.bee-awake, .bee-idle):is([data-icon="shield"], [data-icon="tilt"], [data-icon="tower"]) .bee-eyes-wake > :nth-child(1) { animation: bee-look-reye 1.2s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle):is([data-icon="shield"], [data-icon="tilt"], [data-icon="tower"]) .bee-eyes-wake > :nth-child(2) { animation: bee-look-leye 1.2s ease-in-out; }

/* ── Awake hover: piece animations per bee type ── */

/* signal: wings flutter, bar pulses */
.group:hover :is(.bee-awake, .bee-idle)[data-icon="signal"] svg > path:nth-of-type(1) { transform-origin: 50.1% 64.2%; animation: bee-flutter-l 0.6s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="signal"] svg > path:nth-of-type(2) { transform-origin: 40.4% 15.1%; animation: bee-flutter-r 0.6s ease-in-out 0.05s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="signal"] svg > path:nth-of-type(3) { transform-box: fill-box; transform-origin: center; animation: bee-pulse 0.5s ease-in-out 0.1s; }

/* cross: 4 quarters flutter */
.group:hover :is(.bee-awake, .bee-idle)[data-icon="cross"] svg > path:nth-of-type(1) { transform-origin: 12.3% 56.2%; animation: bee-flutter-l 0.5s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="cross"] svg > path:nth-of-type(2) { transform-origin: 12.6% 43.7%; animation: bee-flutter-r 0.5s ease-in-out 0.06s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="cross"] svg > path:nth-of-type(3) { transform-origin: 87.3% 43.7%; animation: bee-flutter-l 0.5s ease-in-out 0.12s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="cross"] svg > path:nth-of-type(4) { transform-origin: 87.3% 56.2%; animation: bee-flutter-r 0.5s ease-in-out 0.18s; }

/* crown: points flutter, bars bob */
.group:hover :is(.bee-awake, .bee-idle)[data-icon="crown"] svg > path:nth-of-type(1) { transform-origin: 62.6% 15.7%; animation: bee-flutter-l 0.5s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="crown"] svg > path:nth-of-type(2) { transform-origin: 37.5% 15.7%; animation: bee-flutter-r 0.5s ease-in-out 0.06s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="crown"] svg > rect:nth-of-type(1) { animation: bee-bob 0.4s ease-in-out 0.08s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="crown"] svg > rect:nth-of-type(2) { animation: bee-bob 0.4s ease-in-out 0.16s; }

/* shield: wings flutter, bars bob */
.group:hover :is(.bee-awake, .bee-idle)[data-icon="shield"] svg > path:nth-of-type(1) { transform-origin: 28.2% 49.9%; animation: bee-flutter-l 0.55s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="shield"] svg > path:nth-of-type(2) { transform-origin: 72.0% 49.7%; animation: bee-flutter-r 0.55s ease-in-out 0.05s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="shield"] svg > rect:nth-of-type(1) { animation: bee-bob 0.4s ease-in-out 0.04s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="shield"] svg > rect:nth-of-type(2) { animation: bee-bob 0.4s ease-in-out 0.12s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="shield"] svg > rect:nth-of-type(3) { animation: bee-bob 0.4s ease-in-out 0.2s; }

/* bloom: 4 petals flutter, bar bobs */
.group:hover :is(.bee-awake, .bee-idle)[data-icon="bloom"] svg > path:nth-of-type(1) { transform-origin: 56.0% 47.2%; animation: bee-flutter-r 0.5s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="bloom"] svg > path:nth-of-type(2) { transform-origin: 52.4% 43.6%; animation: bee-flutter-l 0.5s ease-in-out 0.07s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="bloom"] svg > path:nth-of-type(3) { transform-origin: 46.6% 44.1%; animation: bee-flutter-r 0.5s ease-in-out 0.14s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="bloom"] svg > path:nth-of-type(4) { transform-origin: 43.0% 47.6%; animation: bee-flutter-l 0.5s ease-in-out 0.21s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="bloom"] svg > rect:nth-of-type(1) { animation: bee-bob 0.4s ease-in-out 0.12s; }

/* tower: bars bob, wings flutter */
.group:hover :is(.bee-awake, .bee-idle)[data-icon="tower"] svg > rect:nth-of-type(1) { animation: bee-bob 0.45s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="tower"] svg > rect:nth-of-type(2) { animation: bee-bob 0.45s ease-in-out 0.1s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="tower"] svg > path:nth-of-type(1) { transform-origin: 28.1% 31.1%; animation: bee-flutter-l 0.5s ease-in-out 0.05s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="tower"] svg > path:nth-of-type(2) { transform-origin: 71.9% 31.3%; animation: bee-flutter-r 0.5s ease-in-out 0.1s; }

/* tilt: slash rocks, wings flutter */
.group:hover :is(.bee-awake, .bee-idle)[data-icon="tilt"] svg > path:nth-of-type(1) { transform-box: fill-box; transform-origin: center; --br: 5deg; animation: bee-rock 0.55s ease-in-out; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="tilt"] svg > path:nth-of-type(2) { transform-origin: 68.8% 31.4%; animation: bee-flutter-r 0.5s ease-in-out 0.06s; }
.group:hover :is(.bee-awake, .bee-idle)[data-icon="tilt"] svg > path:nth-of-type(3) { transform-origin: 43.4% 31.2%; animation: bee-flutter-l 0.5s ease-in-out 0.12s; }

/* ── Sleeping: same shape, idle twitches, breathe on hover ── */
.bee-sleeping svg {
  transform-origin: center bottom;
  transition: transform 0.3s ease;
}

.bee-sleeping[data-icon="signal"] svg > path:nth-of-type(1) { transform-origin: 50.1% 64.2%; animation: bee-twitch 4s ease-in-out infinite 4s; }
.bee-sleeping[data-icon="shield"] svg > path:nth-of-type(2) { transform-origin: 72.0% 49.7%; animation: bee-twitch 5s ease-in-out infinite 5s; }
.bee-sleeping[data-icon="tower"] svg > path:nth-of-type(1) { transform-origin: 28.1% 31.1%; animation: bee-twitch 4s ease-in-out infinite 4.5s; }
.bee-sleeping[data-icon="bloom"] svg > path:nth-of-type(3) { transform-origin: 46.6% 44.1%; animation: bee-twitch 4.5s ease-in-out infinite 6s; }
.bee-sleeping[data-icon="tilt"] svg > path:nth-of-type(2) { transform-origin: 68.8% 31.4%; animation: bee-twitch 3.5s ease-in-out infinite 4.2s; }

.group:hover .bee-sleeping svg {
  animation: bee-breathe 2.5s ease-in-out infinite;
}
.group:hover .bee-sleeping svg > path,
.group:hover .bee-sleeping svg > rect {
  animation: none !important;
}
`;

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = BEE_STYLES;
  document.head.appendChild(style);
}

export function BeeAvatar({
  agentId,
  beeName,
  state,
  colors,
  idle,
  className,
}: {
  agentId?: string;
  beeName?: (typeof BEE_NAMES)[number];
  state: string;
  colors?: BeeColors;
  idle?: boolean;
  className?: string;
}) {
  injectStyles();
  const idx = beeName ? BEE_NAMES.indexOf(beeName) : hashId(agentId ?? "");
  const sleeping = SLEEPING_STATES.has(state);
  const fill: FillArg = sleeping ? "#a2a9b0" : (colors ?? "black");
  const render = bees[idx]!;
  const stateClass = idle ? "bee-idle" : sleeping ? "bee-sleeping" : "bee-awake";
  return (
    <div
      className={cn(
        "bee-avatar size-10 shrink-0 self-center",
        stateClass,
        className,
      )}
      data-icon={BEE_NAMES[idx]}
    >
      {render(fill)}
    </div>
  );
}
