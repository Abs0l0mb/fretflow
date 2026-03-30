'use strict';

import {
    TitledPage,
    Div,
    Button,
    FileInput,
    SimpleNumberInput,
    Form,
    Api
} from '@src/classes';

interface ParamDef {
    key: string;
    label: string;
    defaultValue: number;
    description?: string;
}

export class TabifyPage extends TitledPage {

    private midiFileInput: FileInput;
    private submitButton: Button;
    private suggestButton: Button;
    private values: { [key: string]: number } = {};
    private inputs: { [key: string]: SimpleNumberInput } = {};

    private playerContainer: Div | null = null;
    private playPauseButton: Button | null = null;
    private stopButton: Button | null = null;
    private playerStatus: Div | null = null;
    private alphaTabApi: any = null;

    constructor() {

        super();
        this.build();
    }

    /*
    **
    **
    */
    private build(): void {

        const main = new Div('', this.content);
        main.setStyle('padding', '20px');

        // ── MIDI file ─────────────────────────────────────────────────
        const fileZone = new Div('light-zone', main);
        fileZone.setStyle('margin-bottom', '16px');
        const fileForm = new Form(fileZone);
        this.midiFileInput = new FileInput({ label: 'Sélectionner un fichier .mid' }, fileForm);

        const suggestRow = new Div('', fileZone);
        suggestRow.setStyles({ 'padding': '8px 16px' });
        this.suggestButton = new Button({ label: 'Suggest parameters' }, suggestRow);
        this.suggestButton.onNative('click', this.onSuggest.bind(this));

        // ── General ───────────────────────────────────────────────────
        this.buildGroup(main, 'Général', [
            {
                key: 'step', label: 'Step (ticks)', defaultValue: 60,
                description: 'Quantization step in MIDI ticks. Smaller = more rhythmic detail and more events to process. Default 60 = 1/16 note at 960 tpq.'
            },
            {
                key: 'gpq', label: 'Quarter ticks', defaultValue: 960,
                description: 'Duration of a quarter note in Guitar Pro ticks. Standard is 960. Only change if your MIDI uses a different time resolution.'
            },
            {
                key: 'tempo', label: 'Tempo (BPM)', defaultValue: 120,
                description: 'Playback tempo in beats per minute. Only affects GP5 playback speed — does not change note assignments.'
            },
        ]);

        // ── Search ────────────────────────────────────────────────────
        this.buildGroup(main, 'Recherche', [
            {
                key: 'max_fret', label: 'Max fret', defaultValue: 20,
                description: 'Highest fret the algorithm is allowed to use. Lower values force the tab into lower positions.'
            },
            {
                key: 'per_pitch_k', label: 'Per pitch K', defaultValue: 4,
                description: 'Number of string/fret candidates considered per note before chord assembly. Higher = better results but slower.'
            },
            {
                key: 'chord_k', label: 'Chord K', defaultValue: 50,
                description: 'Maximum number of voicing candidates kept per chord event. Higher = better chord shapes, significantly slower.'
            },
            {
                key: 'beam_size', label: 'Beam size', defaultValue: 100,
                description: 'Number of paths kept alive at each Viterbi step. Higher = better global solution, slower. 100 is a good balance.'
            },
        ]);

        // ── Local cost ────────────────────────────────────────────────
        this.buildGroup(main, 'Coût local', [
            {
                key: 'w_span', label: 'w_span', defaultValue: 1.0,
                description: 'Penalty per fret of hand span within a chord. Higher = algorithm strongly prefers compact fingerings.'
            },
            {
                key: 'w_high', label: 'w_high', defaultValue: 0.2,
                description: 'Penalty per fret above high_fret_threshold. Discourages the algorithm from placing notes in very high positions.'
            },
            {
                key: 'high_fret_threshold', label: 'High fret threshold', defaultValue: 19,
                description: 'Fret above which the high-fret penalty (w_high) is applied. Notes at frets higher than this become increasingly costly.'
            },
            {
                key: 'w_open_bonus', label: 'w_open_bonus', defaultValue: 0,
                description: 'Reward for using open strings (fret 0). Set to a negative value to encourage open string use.'
            },
            {
                key: 'w_string_range', label: 'w_string_range', defaultValue: 0.15,
                description: 'Penalty proportional to the string range used in a chord (highest string number − lowest). Discourages spreading across many strings.'
            },
            {
                key: 'preferred_min_fret', label: 'Preferred min fret', defaultValue: 5,
                description: 'Lower bound of the preferred fret zone. Notes within [preferred_min_fret, preferred_max_fret] receive a reward (w_preferred_zone).'
            },
            {
                key: 'preferred_max_fret', label: 'Preferred max fret', defaultValue: 17,
                description: 'Upper bound of the preferred fret zone. Notes within [preferred_min_fret, preferred_max_fret] receive a reward (w_preferred_zone).'
            },
            {
                key: 'w_preferred_zone', label: 'w_preferred_zone', defaultValue: -1.5,
                description: 'Cost per note inside the preferred fret zone. Negative = reward. Use a negative value to keep the tab in a comfortable mid-neck range.'
            },
            {
                key: 'high_string_threshold', label: 'High string threshold', defaultValue: 2,
                description: 'Strings with number ≤ this are considered "high" (thin) strings. Used by w_high_string to discourage unnecessary use of the thinnest strings.'
            },
            {
                key: 'w_high_string', label: 'w_high_string', defaultValue: 2.0,
                description: 'Penalty per note placed on a high (thin) string (number ≤ high_string_threshold). Keeps the tab on lower strings unless necessary.'
            },
        ]);

        // ── String discontinuity ──────────────────────────────────────
        this.buildGroup(main, 'Accords', [
            {
                key: 'w_holes', label: 'w_holes', defaultValue: 4,
                description: 'Penalty per gap (missing string) within a chord\'s string coverage. A chord on strings 1, 3 has one hole. Discourages unplayable shapes.'
            },
            {
                key: 'w_gap', label: 'w_gap', defaultValue: 0.6,
                description: 'Additional penalty proportional to the largest gap between consecutive used strings. Penalises very wide string skips within a chord.'
            },
            {
                key: 'w_blocks', label: 'w_blocks', defaultValue: 4,
                description: 'Penalty per extra non-consecutive string group (block) in a chord. A chord on strings 1-2 and 5-6 has two blocks — physically awkward.'
            },
        ]);

        // ── Same-string affinity ─────────────────────────────────────
        this.buildGroup(main, 'Affinité même corde', [
            {
                key: 'same_string_pitch_threshold', label: 'Pitch threshold (semitones)', defaultValue: 5,
                description: 'Max pitch distance (semitones) between two consecutive single notes to activate the same-string bonus. 5 = perfect 4th, covers most scalar runs.'
            },
            {
                key: 'w_same_string_bonus', label: 'w_same_string_bonus (< 0)', defaultValue: -1.0,
                description: 'Bonus (negative value) when consecutive close-pitch single notes land on the same string. Encourages legato-friendly voice leading. Try -1.5 to activate. 0 = disabled.'
            },
        ]);

        // ── String jump ──────────────────────────────────────────────
        this.buildGroup(main, 'Saut de corde', [
            {
                key: 'string_jump_threshold', label: 'String jump threshold', defaultValue: 1,
                description: 'Number of strings that can be skipped freely between consecutive single notes. 1 = adjacent strings are free, anything beyond is penalised.'
            },
            {
                key: 'w_string_jump', label: 'w_string_jump', defaultValue: 1.5,
                description: 'Penalty per extra string skipped beyond the threshold, between consecutive single notes. Unlike w_string_center (which averages chords), this targets single-note string hops directly. Try 1.0–3.0.'
            },
        ]);

        // ── Legato ────────────────────────────────────────────────────
        this.buildGroup(main, 'Legato', [
            {
                key: 'allow_legato', label: 'Allow legato (0/1)', defaultValue: 0,
                description: 'Enable hammer-on and pull-off detection in the output. 1 = on, 0 = off. Requires consecutive notes on the same string.'
            },
            {
                key: 'max_fret_distance', label: 'Max fret distance', defaultValue: 5,
                description: 'Maximum fret distance for a hammer-on or pull-off to be marked. Larger values allow bigger stretches to be notated as legato.'
            },
            {
                key: 'speed_threshold', label: 'Speed threshold (ticks)', defaultValue: 480,
                description: 'Notes longer than this duration (in ticks) are always picked, never legato. 480 = 8th note at 960 tpq. Fast notes below this threshold are legato candidates.'
            },
        ]);

        // ── Tapping ───────────────────────────────────────────────────
        this.buildGroup(main, 'Tapping', [
            {
                key: 'allow_tapping', label: 'Allow tapping (0/1)', defaultValue: 0,
                description: 'Enable right-hand tapping candidates during Viterbi search. 1 = on, 0 = off. Only applies to single notes (not chords).'
            },
            {
                key: 'tap_min_fret', label: 'Tap min fret', defaultValue: 7,
                description: 'Minimum fret for a note to be considered tappable. Notes below this fret are never tapped — they\'re easier to fret normally.'
            },
            {
                key: 'w_tap_activation', label: 'w_tap_activation', defaultValue: 2.0,
                description: 'Cost paid every time a tapping event is used. Higher = less tapping in the output. Acts as a bias toward normal fretting unless tapping is clearly beneficial.'
            },
            {
                key: 'w_tap_deactivation', label: 'w_tap_deactivation', defaultValue: 0.5,
                description: 'Extra cost when transitioning back from tapping to normal fretting. Discourages rapid tap on/off switching.'
            },
            {
                key: 'w_tap_jump', label: 'w_tap_jump', defaultValue: 1.0,
                description: 'Cost per fret of tapping hand movement between consecutive tapped notes. Models the fact that the right hand must travel between tap positions.'
            },
        ]);

        // ── Transition cost ───────────────────────────────────────────
        this.buildGroup(main, 'Coût de transition', [
            {
                key: 'w_jump', label: 'w_jump', defaultValue: 0.8,
                description: 'Main weight for fretting hand position jumps between events. Higher = algorithm strongly avoids large position shifts.'
            },
            {
                key: 'jump_power', label: 'jump_power', defaultValue: 1.2,
                description: 'Exponent applied to the jump distance before multiplying by w_jump. Values > 1 penalise large jumps more aggressively than small ones.'
            },
            {
                key: 'jump_threshold', label: 'jump_threshold', defaultValue: 5,
                description: 'If a position jump exceeds this fret distance, a flat extra penalty (jump_threshold_penalty) is added on top of the normal jump cost.'
            },
            {
                key: 'jump_threshold_penalty', label: 'jump_threshold_penalty', defaultValue: 3.0,
                description: 'Flat penalty added when a jump exceeds jump_threshold. Acts as a hard discouragement of very large position shifts.'
            },
            {
                key: 'w_avg_jump', label: 'w_avg_jump', defaultValue: 0.6,
                description: 'Penalty for the average fret position shift (complements the anchor jump). Smooths out position changes across the whole hand.'
            },
            {
                key: 'avg_jump_power', label: 'avg_jump_power', defaultValue: 1.3,
                description: 'Exponent for the average jump cost. Values > 1 penalise large average jumps more than small ones.'
            },
            {
                key: 'w_span_change', label: 'w_span_change', defaultValue: 0.25,
                description: 'Penalty for changing hand span between consecutive events. Encourages the hand to maintain a consistent stretch width.'
            },
            {
                key: 'w_string_center', label: 'w_string_center', defaultValue: 3,
                description: 'Penalty for shifting the average string used between events. Higher = algorithm prefers staying on the same string group.'
            },
            {
                key: 'close_jump_threshold', label: 'close_jump_threshold', defaultValue: 4.0,
                description: 'Jumps smaller than this fret distance are considered "close" and receive a bonus (close_jump_bonus). Rewards small, smooth position changes.'
            },
            {
                key: 'close_jump_bonus', label: 'close_jump_bonus', defaultValue: -1.2,
                description: 'Bonus (negative cost) applied when a jump is within close_jump_threshold. Rewards staying in the same position area.'
            },
            {
                key: 'rest_enter_penalty', label: 'rest_enter_penalty', defaultValue: 0.0,
                description: 'Extra cost when transitioning from a rest into a note. Can be used to discourage the hand from repositioning during rests.'
            },
            {
                key: 'rest_exit_penalty', label: 'rest_exit_penalty', defaultValue: 0.0,
                description: 'Extra cost when transitioning from a note into a rest. Rarely needed; useful if rest placements are causing unwanted position changes.'
            },
            {
                key: 'w_streak', label: 'w_streak', defaultValue: 4.0,
                description: 'Penalty per extra step in a directional fret-crawl streak. Models the 4-finger physical limit — crawling up or down the neck indefinitely is awkward.'
            },
            {
                key: 'streak_min_len', label: 'streak_min_len', defaultValue: 4,
                description: 'Number of consecutive same-direction steps before the streak penalty activates. Default 4 matches the 4-finger limit.'
            },
            {
                key: 'streak_speed_threshold', label: 'streak_speed_threshold', defaultValue: 480,
                description: 'Notes slower than this (in ticks) reset the streak counter — only fast notes count toward a streak. 480 = 8th note at 960 tpq.'
            },
        ]);

        // ── Submit ────────────────────────────────────────────────────
        const footer = new Div('', main);
        footer.setStyle('margin-top', '8px');
        this.submitButton = new Button({ label: 'Générer la tablature' }, footer);
        this.submitButton.onNative('click', this.onSubmit.bind(this));

        // ── AlphaTab player ───────────────────────────────────────────
        this.playerContainer = new Div('light-zone', main);
        this.playerContainer.setStyles({ 'margin-top': '16px', 'display': 'none' });

        const playerControls = new Div('', this.playerContainer);
        playerControls.setStyles({
            'display':       'flex',
            'align-items':   'center',
            'gap':           '8px',
            'padding':       '10px 16px',
            'border-bottom': '1px solid rgba(0,0,0,0.08)',
        });

        this.playPauseButton = new Button({ label: '▶ Play' }, playerControls);
        this.playPauseButton.onNative('click', () => this.alphaTabApi?.playPause());

        this.stopButton = new Button({ label: '■ Stop' }, playerControls);
        this.stopButton.onNative('click', () => this.alphaTabApi?.stop());

        this.playerStatus = new Div('', playerControls);
        this.playerStatus.setStyles({ 'font-size': '12px', 'color': 'rgba(0,0,0,0.4)', 'margin-left': '8px' });

        const atContainer = new Div('', this.playerContainer);
        atContainer.setAttribute('id', 'alphatab-container');
        atContainer.setStyles({ 'overflow-x': 'auto', 'min-height': '200px' });

        this._atContainer = atContainer;
    }

    private _atContainer: Div | null = null;

    /*
    **
    **
    */
    private buildGroup(parent: Div, title: string, params: ParamDef[]): void {

        const section = new Div('light-zone', parent);
        section.setStyle('margin-bottom', '16px');

        const titleDiv = new Div('', section);
        titleDiv.setStyles({
            'padding':       '10px 16px',
            'font-size':     '13px',
            'font-weight':   '600',
            'color':         'rgba(0,0,0,0.5)',
            'border-bottom': '1px solid rgba(0,0,0,0.08)',
            'text-transform':'uppercase',
            'letter-spacing':'0.04em'
        }).write(title);

        const grid = new Div('', section);
        grid.setStyles({
            'display':   'flex',
            'flex-wrap': 'wrap',
            'gap':       '6px',
            'padding':   '12px 16px'
        });

        for (const { key, label, defaultValue, description } of params) {

            this.values[key] = defaultValue;

            const input = new SimpleNumberInput({ label, value: defaultValue }, grid);
            input.setStyles({
                'border':        '1px solid rgba(0,0,0,0.1)',
                'border-radius': '5px',
                'background':    '#e9e9e9'
            });

            if (description)
                input.setAttribute('title', description);

            input.on('value', (v: number) => {
                this.values[key] = v;
            });

            this.inputs[key] = input;
        }
    }

    /*
    **
    **
    */
    private async onSuggest(): Promise<void> {

        const { base64, name } = this.getMidiFile();

        if (!base64 || !name) {
            alert('Veuillez sélectionner un fichier MIDI.');
            return;
        }

        this.suggestButton.load();

        try {
            const suggested: { [key: string]: number } = await Api.post('/suggest-params', {
                midi_base64: base64,
                midi_name:   name,
            });

            for (const [key, value] of Object.entries(suggested)) {
                if (key in this.inputs) {
                    this.inputs[key].setValue(value, false);
                    this.values[key] = value;
                }
            }
        } catch (error) {
            alert(`Erreur : ${error}`);
        } finally {
            this.suggestButton.unload();
        }
    }

    /*
    **
    **
    */
    private async onSubmit(): Promise<void> {

        const { base64, name } = this.getMidiFile();

        if (!base64 || !name) {
            alert('Veuillez sélectionner un fichier MIDI.');
            return;
        }

        this.submitButton.load();

        try {
            const arrayBuffer: ArrayBuffer = await Api.request('POST', '/tabify', {
                midi_base64: base64,
                midi_name:   name,
                ...this.getValues()
            }, true);

            const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = name.replace(/\.midi?$/i, '') + '.gp5';
            a.click();
            URL.revokeObjectURL(url);

            await this.loadGp5(arrayBuffer);

        } catch (error) {
            alert(`Erreur : ${error}`);
        } finally {
            this.submitButton.unload();
        }
    }

    /*
    **
    **
    */
    private ensureAlphaTabScript(): Promise<void> {

        return new Promise((resolve, reject) => {

            if ((window as any).alphaTab) { resolve(); return; }

            const script = document.createElement('script');
            script.src = '/assets/alphatab/alphaTab.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load AlphaTab script'));
            document.head.appendChild(script);
        });
    }

    /*
    **
    **
    */
    private async loadGp5(arrayBuffer: ArrayBuffer): Promise<void> {

        await this.ensureAlphaTabScript();

        const at = (window as any).alphaTab;

        if (!this.playerContainer || !this._atContainer) return;

        this.playerContainer.setStyle('display', 'block');
        this.playerStatus!.write('Loading…');

        if (this.alphaTabApi) {
            this.alphaTabApi.load(new Uint8Array(arrayBuffer));
            return;
        }

        const container = this._atContainer.element as HTMLElement;

        this.alphaTabApi = new at.AlphaTabApi(container, {
            core: {
                scriptFile:    '/assets/alphatab/alphaTab.min.js',
                fontDirectory: '/assets/alphatab/font/',
            },
            player: {
                enablePlayer: true,
                soundFont:    '/assets/alphatab/soundfont/sonivox.sf2',
            },
        });

        this.alphaTabApi.playerStateChanged.on((e: any) => {
            this.playPauseButton!.write(e.state === 1 ? '⏸ Pause' : '▶ Play');
        });

        this.alphaTabApi.scoreLoaded.on(() => {
            this.playerStatus!.write('');
        });

        this.alphaTabApi.error.on((e: any) => {
            this.playerStatus!.write('Error: ' + (e.message ?? e));
        });

        this.alphaTabApi.load(new Uint8Array(arrayBuffer));
    }

    /*
    **
    **
    */
    public getValues(): { [key: string]: number } {

        return { ...this.values };
    }

    /*
    **
    **
    */
    public getMidiFile(): { base64: string | null; name: string | null } {

        return {
            base64: this.midiFileInput.getValue(),
            name:   this.midiFileInput.getName(),
        };
    }
}
