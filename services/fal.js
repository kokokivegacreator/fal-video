const { fal } = require('@fal-ai/client');

const MODELS = {
  veo3: {
    id: 'fal-ai/veo3.1/reference-to-video',
    label: 'Veo 3.1 (Google)',
    maxDuration: 8,
    durations: [8],
    imageKey: 'image_urls',
    imageAsArray: true,
    durationSuffix: 's',
  },
  kling_pro: {
    id: 'fal-ai/kling-video/v1.6/pro/image-to-video',
    label: 'Kling v1.6 Pro',
    maxDuration: 10,
    durations: [5, 10],
    imageKey: 'image_url',
  },
  kling_std: {
    id: 'fal-ai/kling-video/v1.6/standard/image-to-video',
    label: 'Kling v1.6 Standard',
    maxDuration: 10,
    durations: [5, 10],
    imageKey: 'image_url',
  },
  luma: {
    id: 'fal-ai/luma-dream-machine/image-to-video',
    label: 'Luma Dream Machine',
    maxDuration: 5,
    durations: [5],
    imageKey: 'image_url',
  },
  minimax: {
    id: 'fal-ai/minimax-video-01/image-to-video',
    label: 'MiniMax Video-01',
    maxDuration: 6,
    durations: [6],
    imageKey: 'image_url',
  },
  wan: {
    id: 'fal-ai/wan-i2v',
    label: 'WAN Image-to-Video',
    maxDuration: 5,
    durations: [5],
    imageKey: 'image_url',
  },
};

function init() {
  fal.config({ credentials: process.env.FAL_KEY });
}

async function uploadImageToFal(buffer, mimeType, filename) {
  const blob = new Blob([buffer], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });
  const url = await fal.storage.upload(file);
  return url;
}

async function generateVideo({ imageUrl, prompt, model, duration, aspectRatio, onQueueUpdate }) {
  const modelConfig = MODELS[model] || MODELS.kling_pro;

  const imageKey = modelConfig.imageKey || 'image_url';
  const imageValue = modelConfig.imageAsArray ? [imageUrl] : imageUrl;
  const dur = duration || modelConfig.durations[0];
  const durationVal = modelConfig.durationSuffix
    ? `${dur}${modelConfig.durationSuffix}`
    : String(dur);
  const input = {
    [imageKey]: imageValue,
    prompt: prompt || '',
    duration: durationVal,
    aspect_ratio: aspectRatio || '16:9',
  };

  const result = await fal.subscribe(modelConfig.id, {
    input,
    logs: true,
    onQueueUpdate: (update) => {
      if (onQueueUpdate) onQueueUpdate(update);
    },
  });

  const videoUrl = result?.data?.video?.url || result?.video?.url || result?.data?.video_url;
  if (!videoUrl) throw new Error('fal.ai did not return a video URL');

  return { videoUrl, modelConfig };
}

module.exports = { init, uploadImageToFal, generateVideo, MODELS };
