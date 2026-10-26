import type { Handlers, PageProps } from "$fresh/server.ts";
import ClassroomChat from "../islands/ClassroomChat.tsx";
import ChatWarning from "../components/Warning.tsx";
import Header from "../islands/Header.tsx";
import { findClassroom, validSlug } from "../utils/classroomStore.ts";
import { hasAgreementCookie } from "../utils/agreement.ts";
import {
  learningPathQuery,
  parseLearningPathTarget,
} from "../utils/learningPathLinks.ts";

interface Data {
  slug: string;
  initialAgreed: boolean;
  returnTo: string;
}

export const handler: Handlers<Data> = {
  async GET(req, ctx) {
    const slug = ctx.params.slug.toLowerCase();
    if (!validSlug(slug) || !await findClassroom(slug)) {
      return new Response("Diese Klassen-Chatseite gibt es nicht.", {
        status: 404,
      });
    }
    const target = parseLearningPathTarget(new URL(req.url).search);
    return ctx.render({
      slug,
      initialAgreed: hasAgreementCookie(req),
      returnTo: `/${slug}${target ? learningPathQuery(target) : ""}`,
    });
  },
};

export default function ClassroomPage({ data }: PageProps<Data>) {
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
        <Header lang="de" showMenu={false} />
        <ClassroomChat
          slug={data.slug}
          brand="Buddy"
          initialAgreed={data.initialAgreed}
          returnTo={data.returnTo}
        />
        <ChatWarning lang="de" />
      </div>
    </div>
  );
}
