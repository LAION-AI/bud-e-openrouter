// islands/ChatAgreementOrIsland.tsx
//
// Shows the chat, or the terms if they have not been accepted yet.
//
// The decision cannot be made while rendering: localStorage does not exist on
// the server, and reading it during the render made the server and the
// browser disagree about what the page contains. Preact then hydrates one
// tree onto another, and the handlers end up attached to the wrong elements -
// which is how the accept button came to do nothing.
//
// So the terms are what gets rendered first, on both sides, and the browser
// switches to the chat after mounting if the agreement is already stored.

import { useEffect, useState } from "preact/hooks";
import ChatAgreement, { hasAgreed } from "./ChatAgreement.tsx";
import ChatIsland from "./ChatIsland.tsx";
import ChatWarning from "../components/Warning.tsx";

interface Props {
  lang: string;
}

export default function ChatAgreementOrIsland({ lang }: Props) {
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (hasAgreed()) setAgreed(true);
  }, []);

  if (!agreed) {
    return <ChatAgreement lang={lang} onAgree={() => setAgreed(true)} />;
  }
  return (
    <>
      <ChatIsland lang={lang} /> <ChatWarning lang={lang} />
    </>
  );
}
