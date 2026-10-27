using DTOs;

namespace CriptoVersus.API.Services;

/// <summary>
/// Estado leve do diretor automatico de transmissao, mantido em memoria pelo processo da API.
///
/// Guarda (a) a selecao atual em exibicao, (b) o horario em que o conteudo comecou a ser
/// exibido e (c) o historico recente de replays exibidos para evitar repeticao excessiva.
/// E deliberadamente sem banco: e um estado operacional de transmissao, nao um registro de
/// auditoria. Limitacao documentada: em uma implantacao com multiplas replicas de API cada
/// processo mantem o proprio historico.
/// </summary>
public interface ICandleBattleBroadcastSessionStore
{
    CandleBattleBroadcastSelectionDto? Selection { get; }
    DateTime? SelectedAtUtc { get; }
    DateTime? ServedAtUtc { get; }
    DateTime? EmptyUntilUtc { get; }

    /// <summary>
    /// Registra a selecao em exibicao. <paramref name="servedAtUtc"/> so e aplicado quando o
    /// conteudo muda; manter a mesma partida preserva o inicio da exibicao (replays nao reiniciam).
    /// </summary>
    void SetSelection(CandleBattleBroadcastSelectionDto selection, DateTime servedAtUtc, DateTime selectedAtUtc);
    void SetEmptyUntil(DateTime emptyUntilUtc);
    void Clear();

    DateTime? GetReplayShownAtUtc(int matchId);
    void MarkReplayShown(int matchId, DateTime shownAtUtc, int maxHistory);
    IReadOnlyList<int> ReplayHistory { get; }
}

public sealed class CandleBattleBroadcastSessionStore : ICandleBattleBroadcastSessionStore
{
    private readonly object _gate = new();
    private readonly Dictionary<int, DateTime> _replayShown = [];
    private readonly Queue<int> _replayOrder = [];
    private CandleBattleBroadcastSelectionDto? _selection;
    private DateTime? _selectedAtUtc;
    private DateTime? _servedAtUtc;
    private DateTime? _emptyUntilUtc;

    public CandleBattleBroadcastSelectionDto? Selection { get { lock (_gate) return _selection; } }
    public DateTime? SelectedAtUtc { get { lock (_gate) return _selectedAtUtc; } }
    public DateTime? ServedAtUtc { get { lock (_gate) return _servedAtUtc; } }
    public DateTime? EmptyUntilUtc { get { lock (_gate) return _emptyUntilUtc; } }

    public void SetSelection(CandleBattleBroadcastSelectionDto selection, DateTime servedAtUtc, DateTime selectedAtUtc)
    {
        lock (_gate)
        {
            var contentChanged = _selection is null
                || _selection.MatchId != selection.MatchId
                || _selection.Mode != selection.Mode;
            if (contentChanged)
            {
                _servedAtUtc = servedAtUtc;
                _selectedAtUtc = selectedAtUtc;
            }
            else
            {
                _selectedAtUtc ??= selectedAtUtc;
            }

            _selection = selection;
            _emptyUntilUtc = null;
        }
    }

    public void SetEmptyUntil(DateTime emptyUntilUtc)
    {
        lock (_gate) _emptyUntilUtc = emptyUntilUtc;
    }

    public void Clear()
    {
        lock (_gate)
        {
            _selection = null;
            _selectedAtUtc = null;
            _servedAtUtc = null;
        }
    }

    public DateTime? GetReplayShownAtUtc(int matchId)
    {
        lock (_gate) return _replayShown.TryGetValue(matchId, out var shown) ? shown : null;
    }

    public void MarkReplayShown(int matchId, DateTime shownAtUtc, int maxHistory)
    {
        lock (_gate)
        {
            if (_replayShown.Remove(matchId))
            {
                // Reexibicao atualiza a posicao no historico sem crescer o buffer.
                var rebuilt = new Queue<int>(_replayOrder.Where(id => id != matchId));
                _replayOrder.Clear();
                foreach (var id in rebuilt) _replayOrder.Enqueue(id);
            }

            _replayShown[matchId] = shownAtUtc;
            _replayOrder.Enqueue(matchId);

            var limit = Math.Max(1, maxHistory);
            while (_replayOrder.Count > limit)
            {
                var oldest = _replayOrder.Dequeue();
                if (oldest != matchId) _replayShown.Remove(oldest);
            }
        }
    }

    public IReadOnlyList<int> ReplayHistory { get { lock (_gate) return _replayOrder.ToArray(); } }
}
