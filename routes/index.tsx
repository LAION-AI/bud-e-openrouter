import type { Handlers, PageProps } from "$fresh/server.ts";
import Header from "../islands/Header.tsx";
import ChatAgreementOrIsland from "../islands/ChatAgreementOrIsland.tsx";
import { hasAgreementCookie } from "../utils/agreement.ts";
import {
  learningPathQuery,
  parseLearningPathTarget,
} from "../utils/learningPathLinks.ts";

interface Data {
  lang: string;
  initialAgreed: boolean;
  returnTo: string;
}

export const handler: Handlers<Data> = {
  GET(req, ctx) {
    const url = new URL(req.url);
    const target = parseLearningPathTarget(url.search);
    return ctx.render({
      lang: url.searchParams.get("lang") ?? "de",
      initialAgreed: hasAgreementCookie(req),
      returnTo: target ? `/${learningPathQuery(target)}` : "/",
    });
  },
};

export default function Home({ data }: PageProps<Data>) {
  const { lang, initialAgreed, returnTo } = data;

  return (
    <div
      class="px-4 py-8 w-full"
      style={{
        backgroundImage: "url('/lines.svg')",
        backgroundPosition: "center",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        minHeight: "100dvh",
      }}
    >
      <div class="w-full max-w-screen-lg px-1 sm:px-2 mx-auto flex flex-col items-center justify-center">
        <Header lang={lang} />
        <ChatAgreementOrIsland
          lang={lang}
          initialAgreed={initialAgreed}
          returnTo={returnTo}
        />
      </div>
    </div>
  ); // <- return-Klammer schließen
} // <- und auch die Funktions-Klammer schließen!
