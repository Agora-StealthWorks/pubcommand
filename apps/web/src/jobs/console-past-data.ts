import { defineJob } from "@/lib/jobs/types";
import { copyPackagerIntoConsole, copyPromosIntoConsole, copyVideosIntoConsole } from "@/features/console/past-data";

/**
 * Keep the admin console's Promo Analyzer, Packager and VidRipper current with
 * every organization: new promos (with files and analyses), their packages and
 * training examples, and captured videos are copied in batches; analyses an
 * original gets later follow to its copy. Originals are never changed.
 */
export const consolePastData = defineJob({
  name: "console.past-data",
  description: "Copy promos, packages, training examples and videos from every organization into the admin console.",
  schedule: "40 * * * *",
  async run() {
    const promos = await copyPromosIntoConsole({ limit: 60 });
    const packager = await copyPackagerIntoConsole();
    const videos = await copyVideosIntoConsole({ limit: 80 });
    return { promos: promos.copied ?? 0, analyses: promos.analyses ?? 0, promosLeft: promos.remaining ?? 0, packages: packager.packages ?? 0, examples: packager.examples ?? 0, videos: videos.copied ?? 0, videosLeft: videos.remaining ?? 0 };
  },
});
