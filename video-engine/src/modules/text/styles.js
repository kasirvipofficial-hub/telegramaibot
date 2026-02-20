
// Text Style Definitions
// Format: ASS Style String Components

const styles = {
    // Standard Arial
    basic: {
        font: 'Arial',
        size: 24,
        primary_color: '&H00FFFFFF', // White
        outline_color: '&H00000000', // Black
        back_color: '&H00000000',
        bold: 0,
        italic: 0,
        outline: 1,
        shadow: 0,
        alignment: 2 // Bottom Center
    },
    // High Energy / Sports
    impact_heavy: {
        font: 'Impact',
        size: 110, // Increased from 30 to 110 for 1080p vertical
        primary_color: '&H0000FFFF', // Yellow
        outline_color: '&H00000000', // Black
        back_color: '&H80000000',
        bold: 1,
        italic: 0,
        outline: 5, // Thicker outline
        shadow: 3,
        alignment: 2,
        margin_v: 250 // Higher up to avoid safe areas
    },
    // Cinematic / Elegant
    cinematic: {
        font: 'Times New Roman',
        size: 90, // Increased from 20 to 90
        primary_color: '&H00E0E0E0',
        outline_color: '&H00000000',
        back_color: '&H00000000',
        bold: 0,
        italic: 1,
        outline: 2,
        shadow: 0,
        alignment: 2,
        spacing: 5,
        margin_v: 200
    },
    // Gothic / Ancient
    gothic: {
        font: 'UnifrakturMaguntia',
        size: 100,
        primary_color: '&H00FFFFFF',
        outline_color: '&H00000000',
        back_color: '&H00000000',
        bold: 0,
        italic: 0,
        outline: 3,
        shadow: 2,
        alignment: 2,
        margin_v: 250
    },
    // Modern Sans (Oswald)
    oswald_bold: {
        font: 'Oswald',
        size: 120,
        primary_color: '&H00E6E6FA', // Lavender blush
        outline_color: '&H00191970', // Midnight blue
        back_color: '&H80000000',
        bold: 1,
        italic: 0,
        outline: 4,
        shadow: 2,
        alignment: 2,
        margin_v: 300
    },
    // Elegant Serif (DM Serif Text)
    modern_serif: {
        font: 'DM Serif Text',
        size: 100,
        primary_color: '&H00FFFFFF',
        outline_color: '&H003E2723', // Dark brown
        back_color: '&H00000000',
        bold: 0,
        italic: 1,
        outline: 2,
        shadow: 0,
        alignment: 2,
        margin_v: 200
    }
};

export default {
    getStyle(nameOrObject, overrides = {}) {
        let base = styles.basic;

        if (typeof nameOrObject === 'string') {
            base = styles[nameOrObject] || styles.basic;
        } else if (typeof nameOrObject === 'object' && nameOrObject !== null) {
            base = nameOrObject;
        }

        // Merge overrides
        const final = { ...base, ...overrides };

        // Construct ASS Style string
        // Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
        return `Style: Default,${final.font || 'Arial'},${final.size || 24},${final.primary_color || '&H00FFFFFF'},&H000000FF,${final.outline_color || '&H00000000'},${final.back_color || '&H00000000'},${final.bold || 0},${final.italic || 0},0,0,100,100,${final.spacing || 0},0,1,${final.outline || 1},${final.shadow || 0},${final.alignment || 2},10,10,${final.margin_v || 10},1`;
    }
};
