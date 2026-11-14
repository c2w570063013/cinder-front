// Audio module entry — see `AudioApi` in src/core/api.ts.
// Everything is synthesised with WebAudio at runtime; there are no audio assets.
import type { CreateAudio } from '../core/api';
import { createAudioSystem } from './system';

export const createAudio: CreateAudio = () => createAudioSystem();
