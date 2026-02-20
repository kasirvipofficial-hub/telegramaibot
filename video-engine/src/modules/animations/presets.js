
// ASS Animation Generators
// Each function receives durationMs and resolution string (e.g. "1080x1920")

export default {
    // Slide Up with Fade
    slide_up: (durationMs = 500, resolution = "1080x1920") => {
        return `{\\fad(300,300)}`;
    },

    // Bounce entrance from bottom
    slide_up_bounce: (durationMs = 500, resolution = "1080x1920") => {
        const [w, h] = resolution.split('x').map(Number);
        const centerX = Math.round(w / 2);
        const startY = h - 120;
        const endY = h - 320;

        return `{\\fad(200,200)\\move(${centerX}, ${startY}, ${centerX}, ${endY}, 0, 400)}`;
    },

    // Zoom In (Pop)
    zoom_in: (durationMs = 500, resolution = "1080x1920") => {
        return `{\\fscx0\\fscy0\\t(0,300,\\fscx100\\fscy100)}`;
    },

    // Flash highlight
    flash: (durationMs = 500, resolution = "1080x1920") => {
        return `{\\t(0,100,\\1c&HFFFFFF&)\\t(100,200,\\1c&H00FFFF&)}`;
    }
};
