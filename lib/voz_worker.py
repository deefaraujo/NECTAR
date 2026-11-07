# Worker de voz do NECTAR: reconhecimento de fala (faster-whisper, GPU quando houver) e síntese (Piper), tudo local.
# Protocolo: uma linha JSON por pedido no stdin, uma linha JSON por resposta no stdout. Fica carregado entre pedidos.
#   {"id":1,"op":"stt","wav":"caminho.wav","idioma":"pt"}  -> {"id":1,"texto":"...","segundos":2.1,"ms":430}
#   {"id":2,"op":"tts","texto":"...","wav":"saida.wav"}      -> {"id":2,"ok":true,"segundos":3.4,"ms":380}
# Nada sai daqui para a internet, exceto o download do modelo na primeira vez (feito pela própria biblioteca).
import json
import os
import sys
import time
import wave

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
sys.stderr.reconfigure(encoding="utf-8")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def responder(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def carregar_stt():
    from faster_whisper import WhisperModel
    pedido = os.environ.get("STUDIO_VOZ_MODELO")
    # GPU: o turbo (large-v3-turbo) entende português bem melhor que o small e cabe em 6 GB; sem GPU, o small na CPU
    tentativas = [(pedido or "large-v3-turbo", "cuda", "int8_float16"), (pedido or "small", "cpu", "int8")]
    erro = None
    for modelo, device, tipo in tentativas:
        try:
            return WhisperModel(modelo, device=device, compute_type=tipo), f"{modelo}@{device}"
        except Exception as e:
            erro = e
    raise erro


def ler_wav(caminho):
    """WAV PCM -> float32 mono a 16 kHz, sem depender de decodificador externo (o navegador já grava assim)."""
    import numpy as np
    with wave.open(caminho, "rb") as w:
        canais, largura, taxa, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        bruto = w.readframes(n)
    if largura == 2:
        a = np.frombuffer(bruto, dtype=np.int16).astype(np.float32) / 32768.0
    elif largura == 4:
        a = np.frombuffer(bruto, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        a = (np.frombuffer(bruto, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    if canais > 1:
        a = a.reshape(-1, canais).mean(axis=1)
    if taxa != 16000:
        alvo = int(round(len(a) * 16000 / taxa))
        a = np.interp(np.linspace(0, len(a) - 1, alvo), np.arange(len(a)), a).astype(np.float32)
    return a


class VozPiper:
    """Rápida (menos de 1 s por frase), timbre sintético."""
    def __init__(self, caminho):
        from piper import PiperVoice
        self.v = PiperVoice.load(caminho)
    def gerar(self, texto, wav):
        with wave.open(wav, "wb") as w:
            self.v.synthesize_wav(texto, w)


class VozChatterbox:
    """Natural (Chatterbox Multilingual, MIT), ~3,5 GB de VRAM, 1,5 a 2,5x mais lenta que o tempo real nesta GPU."""
    def __init__(self):
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        self.torch = torch
        self.m = ChatterboxMultilingualTTS.from_pretrained(device="cuda" if torch.cuda.is_available() else "cpu")
        self.ref_atual = None   # WAV curto de uma voz brasileira que dá o timbre e o sotaque; sem ele a voz padrão soa estrangeira
    def gerar(self, texto, wav, ref=None, cfg=0.5, exag=0.5):
        import numpy as np
        if ref and os.path.exists(ref) and ref != self.ref_atual:   # o condicionamento da voz é caro: só refaz quando a voz muda
            self.m.prepare_conditionals(ref, exaggeration=float(exag))
            self.ref_atual = ref
        with self.torch.inference_mode():
            # cfg_weight menor = fala mais pausada; exaggeration maior = mais expressiva (e um pouco mais rápida)
            a = self.m.generate(texto, language_id="pt", cfg_weight=float(cfg), exaggeration=float(exag))
        # PCM de 16 bits (o torchaudio gravaria em ponto flutuante, que o navegador e o leitor de WAV não entendem)
        amostras = np.clip(a.squeeze().cpu().numpy(), -1.0, 1.0)
        # apara o silêncio das pontas (deixa 60 ms): emendado ao trecho seguinte, o silêncio virava um corte audível na fala
        acima = np.flatnonzero(np.abs(amostras) > 0.01)
        if acima.size:
            folga = int(self.m.sr * 0.06)
            amostras = amostras[max(0, acima[0] - folga):min(len(amostras), acima[-1] + folga)]
        with wave.open(wav, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(self.m.sr)
            w.writeframes((amostras * 32767).astype(np.int16).tobytes())


def carregar_tts():
    # Uma voz só no produto, a de maior qualidade (Chatterbox Multilingual). Sem ela instalada, o app explica em vez de cair
    # numa voz pior em silêncio.
    try:
        return VozChatterbox(), "chatterbox-multilingual"
    except Exception as e:
        sys.stderr.write(f"voz natural indisponível: {str(e)[:200]}\n")
        return None, None


def main():
    # O app pode dividir em dois processos (STUDIO_VOZ_PAPEL=stt ou tts): o reconhecimento (CTranslate2) e a voz natural (torch)
    # carregam versões diferentes do cuDNN e não convivem no mesmo processo.
    papel = os.environ.get("STUDIO_VOZ_PAPEL") or "ambos"
    stt, stt_nome = carregar_stt() if papel in ("ambos", "stt") else (None, None)
    tts, tts_nome = carregar_tts() if papel in ("ambos", "tts") else (None, None)
    responder({"pronto": True, "stt": stt_nome, "tts": tts_nome, "papel": papel})
    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            p = json.loads(linha)
        except Exception:
            continue
        t0 = time.time()
        try:
            if p.get("op") == "stt":
                if stt is None:
                    responder({"id": p.get("id"), "erro": "este processo não faz reconhecimento"})
                    continue
                segs, info = stt.transcribe(ler_wav(p["wav"]), language=p.get("idioma") or "pt", beam_size=1, vad_filter=True,
                                            vad_parameters={"min_silence_duration_ms": 300}, condition_on_previous_text=False)
                texto = " ".join(s.text.strip() for s in segs).strip()
                responder({"id": p.get("id"), "texto": texto, "segundos": round(info.duration or 0, 2), "ms": int((time.time() - t0) * 1000)})
            elif p.get("op") == "tts":
                if tts is None:
                    responder({"id": p.get("id"), "erro": "voz do Piper não instalada"})
                    continue
                tts.gerar(p["texto"], p["wav"], ref=p.get("ref"), cfg=p.get("cfg", 0.5), exag=p.get("exag", 0.5))
                with wave.open(p["wav"], "rb") as w:
                    dur = w.getnframes() / float(w.getframerate())
                responder({"id": p.get("id"), "ok": True, "segundos": round(dur, 2), "ms": int((time.time() - t0) * 1000)})
            elif p.get("op") == "ping":
                responder({"id": p.get("id"), "ok": True})
            else:
                responder({"id": p.get("id"), "erro": "operação desconhecida"})
        except Exception as e:
            responder({"id": p.get("id"), "erro": str(e)[:300]})


if __name__ == "__main__":
    main()
