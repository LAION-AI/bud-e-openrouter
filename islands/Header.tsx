import { JSX } from "preact/jsx-runtime";
import { headerContent } from "../internalization/content.ts";
import Menu from "./Menu.tsx";

/**
 * Header Component
 *
 * This component renders the header section of the application, which includes:
 * - A navigation menu
 * - A logo image
 * - Titles based on the selected language
 *
 * @param {Object} props - The properties object.
 * @param {string} props.lang - The language code for content localization.
 *
 * @returns {JSX.Element} The rendered header component.
 */
function Header({ lang }: { lang: string }): JSX.Element {
  return (
    <header class="flex flex-col justify-between items-center my-3 md:my-6 w-full px-2 md:px-4">
      {/* Render the navigation menu */}
      <Menu lang={lang} />

      {/* Smaller on a phone: the lion and the title took a third of the
          screen before a single message was visible. */}
      <div class="flex items-center align-middle px-2 md:px-4 drop-shadow-2xl rounded-md">
        <img
          src="/logo.png"
          width="128"
          height="128"
          class="w-20 h-20 md:w-32 md:h-32"
          alt="A little lion wearing a graduation cap."
        />

        <div class="flex flex-col">
          <h2 class="text-sm md:text-base text-gray-600 font-semibold tracking-widest italic">
            {headerContent[lang]["overTitle"]}
          </h2>
          <h1 class="text-3xl md:text-4xl text-gray-600 font-semibold block self-center">
            {headerContent[lang]["title"]}
          </h1>
        </div>
      </div>
    </header>
  );
}

export default Header;
