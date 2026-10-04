# StereoGuard

Detects stereo imbalance using per-participant audio. Original plugin by Kurtzon Audio, maintained by DavidHiFi.

Discord Desktop requires the separately installed VoiceVUMeters native bridge with getParticipantStereoLevels and rmsMid/rmsSide fields. The matching native source computes and exports both measurements. Build and install the bridge separately using VoiceVUMeters/native; enabling the plugin does not install it. Without an identified per-participant source, the plugin takes no new mute action. Web uses per-user streams where available.

The detector defaults to -22 dB, with a one-second join grace and five-second remute cooldown. The panel shows scores and local protection settings. TestCord source uses the required GPL-3.0-or-later Vencord header; the original MIT grant remains in LICENSE.
