/**
 * @file ImageUploadButton.tsx
 * @description Button component for uploading images with unique ID assignment,
 *              progress tracking, and metadata (source, timestamp).
 *              IDs use format upl_XXXXX (5 digits) to distinguish from generated images.
 * @importantFunctions ImageUploadButton, handleImageUpload, findAllHighestImageIds
 */

import { useRef, useState } from "preact/hooks";
import { IS_BROWSER } from "$fresh/runtime.ts";

type Variant = "floating" | "inline";

/**
 * Image content part with metadata for tracking and referencing.
 */
export interface ImageWithMetadata {
  type: "image_url";
  image_url: { url: string; detail: "high" | "low" | "auto" };
  id: string; // Unique image identifier (e.g., "upl_00001")
  source: "uploaded";
  timestamp: number;
  filename?: string; // Original filename for reference
}

/**
 * Message type for scanning existing image IDs
 */
interface MessageWithContent {
  role: string;
  content: string | Array<{ type?: string; id?: string; [key: string]: unknown }>;
}

/**
 * Finds the highest image ID number across ALL images in messages.
 * Handles both old format (img_XXX) and new format (gen_XXXXX, upl_XXXXX).
 */
export const findAllHighestImageIds = (
  messages: MessageWithContent[],
): { gen: number; upl: number; legacy: number } => {
  let genMax = 0;
  let uplMax = 0;
  let legacyMax = 0;

  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type === "image_url" && part?.id) {
          const id = String(part.id);

          const genMatch = id.match(/^gen_(\d+)$/);
          if (genMatch) {
            const num = parseInt(genMatch[1], 10);
            if (num > genMax) genMax = num;
          }

          const uplMatch = id.match(/^upl_(\d+)$/);
          if (uplMatch) {
            const num = parseInt(uplMatch[1], 10);
            if (num > uplMax) uplMax = num;
          }

          const legacyMatch = id.match(/^img_(\d+)$/);
          if (legacyMatch) {
            const num = parseInt(legacyMatch[1], 10);
            if (num > legacyMax) legacyMax = num;
          }
        }
      }
    }
  }

  return { gen: genMax, upl: uplMax, legacy: legacyMax };
};

/**
 * Generates a unique upload image ID like "upl_00001".
 */
export const generateUploadImageId = (
  existingMax: number,
  index: number = 0,
): string => {
  const nextId = existingMax + 1 + index;
  return `upl_${String(nextId).padStart(5, "0")}`;
};

function ImageUploadButton({
  onImagesUploaded,
  variant = "floating",
  messages = [],
}: {
  onImagesUploaded: (images: ImageWithMetadata[]) => void;
  variant?: Variant;
  messages?: MessageWithContent[]; // Full message history for ID scanning
}) {
  const [previewImages, setPreviewImages] = useState<
    { file: File; preview: string }[]
  >([]);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onButtonClick = () => fileInputRef.current?.click();

  /**
   * Handles image file uploads with progress tracking and ID assignment.
   * Scans full message history to ensure globally unique IDs.
   */
  const handleImageUpload = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const files = Array.from(target.files || []) as File[];
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    const newPreviews = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file as Blob),
    }));
    setPreviewImages([...previewImages, ...newPreviews]);

    // Find highest existing upload image ID from full message history
    const { upl: existingMax, legacy: legacyMax } = findAllHighestImageIds(
      messages,
    );
    const baseId = Math.max(existingMax, legacyMax);

    const newUploadedImages: ImageWithMetadata[] = [];
    let completed = 0;
    const total = files.length;

    const promises = files.map((file, index) =>
      new Promise<void>((resolve) => {
        const reader = new FileReader();

        reader.onprogress = (e) => {
          if (e.lengthComputable) {
            const fileProgress = (e.loaded / e.total) * 100;
            const overallProgress = ((completed * 100) + fileProgress) / total;
            setUploadProgress(Math.round(overallProgress));
          }
        };

        reader.onload = (e) => {
          const dataUrl = e.target!.result as string;
          const imageId = generateUploadImageId(baseId, index);

          newUploadedImages.push({
            type: "image_url",
            image_url: { url: dataUrl, detail: "high" },
            id: imageId,
            source: "uploaded",
            timestamp: Date.now(),
            filename: file.name,
          });

          completed++;
          setUploadProgress(Math.round((completed / total) * 100));
          resolve();
        };

        reader.onerror = () => {
          console.error(`Failed to read file: ${file.name}`);
          completed++;
          resolve();
        };

        reader.readAsDataURL(file as Blob);
      })
    );

    Promise.all(promises).then(() => {
      setIsUploading(false);
      setUploadProgress(0);
      // Sort by ID to maintain order
      newUploadedImages.sort((a, b) => a.id.localeCompare(b.id));
      onImagesUploaded(newUploadedImages);
      // Reset file input to allow re-uploading the same file
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  };

  const pos = variant === "floating"
    ? "relative md:absolute md:right-3 md:bottom-[6.7rem]"
    : "relative";

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageUpload}
        accept="image/*"
        multiple
        class="hidden"
      />

      <div class={`${pos}`}>
        <button
          onClick={onButtonClick}
          disabled={!IS_BROWSER || isUploading}
          class="disabled:opacity-50 disabled:cursor-not-allowed rounded-md p-2 bg-gray-100 text-blue-600/50 hover:bg-gray-200 transition-colors"
          title={isUploading ? "Uploading images..." : "Upload image(s)"}
        >
          {isUploading
            ? (
              <svg
                class="animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-opacity="0.25"
                />
                <path
                  d="M12 2a10 10 0 0 1 10 10"
                  stroke="currentColor"
                  stroke-linecap="round"
                />
              </svg>
            )
            : (
              /* camera icon */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="icon icon-tabler icons-tabler-outline icon-tabler-photo-up"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M15 8h.01" />
                <path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5" />
                <path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5" />
                <path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526" />
                <path d="M19 22v-6" />
                <path d="M22 19l-3 -3l-3 3" />
              </svg>
            )}
        </button>

        {isUploading && (
          <div class="absolute -bottom-1 left-0 right-0 h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              class="h-full bg-blue-500 transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}
      </div>
    </>
  );
}

export default ImageUploadButton;
