import { JSX } from "preact/jsx-runtime";
import { menuContent } from "../internalization/content.ts";

/**
 * Responsive Menu:
 * - Mobile: statisch, unter/über dem Logo, mit Wrap & Abstand
 * - ≥ md: wie bisher oben rechts absolut positioniert
 */
export default function Menu({ lang }: { lang: string }): JSX.Element {
  const menuItems = [
    { name: lang === "de" ? "Klassenraum" : "Classroom", href: "/my" },
    { name: menuContent[lang]["about"], href: "/about?lang=" + lang },
    { name: menuContent[lang]["imprint"], href: "https://laion.ai/impressum" },
  ];

  const languages = [
    { name: "Deutsch", code: "de", symbol: "🇩🇪" },
    { name: "English", code: "en", symbol: "🇬🇧" },
  ];

  return (
    <div
      class="
        z-30 w-full
        flex flex-wrap items-center justify-end gap-3
        text-xs
        mt-2
        md:mt-0
        md:w-auto md:absolute md:top-0 md:right-0 md:left-auto md:m-4
      "
    >
      {/* Language Selector */}
      <select
        class="bg-white/60 md:bg-transparent border border-gray-300 md:border-0 rounded px-2 py-1"
        onChange={(e) =>
          (globalThis.location = (e.target as HTMLInputElement)
            .value as unknown as Location)}
        value={`/?lang=${lang}`}
        aria-label="Sprache wählen"
      >
        {languages.map((l) => (
          <option key={l.code} value={`/?lang=${l.code}`}>
            {l.symbol}
          </option>
        ))}
      </select>

      {/* Menu Items */}
      {menuItems.map((item) => (
        <a
          key={item.href}
          href={item.href}
          class="text-gray-600 hover:text-gray-800 hover:drop-shadow-md"
        >
          {item.name}
        </a>
      ))}
    </div>
  );
}
