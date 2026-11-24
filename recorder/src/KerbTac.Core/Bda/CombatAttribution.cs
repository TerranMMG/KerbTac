using System;
using System.Collections.Generic;

namespace KerbTac.Core
{
    /// <summary>
    /// Keeps recent attack records so a health drop or a destroyed vessel can be
    /// attributed to the most likely attacker. Only records with a non-empty
    /// attacker are kept; unattributed damage stays anonymous rather than guessed.
    /// </summary>
    public sealed class CombatAttribution
    {
        public const double WindowSeconds = 30.0;
        public const int MaxRecords = 256;

        private sealed class AttackRecord
        {
            public string AttackerId;
            public string TargetId;
            public string Weapon;
            public string ActorId;
            public double Ut;
        }

        private readonly List<AttackRecord> _records = new List<AttackRecord>();

        public void Record(string attackerId, string targetId, string weapon, string actorId, double ut)
        {
            if (string.IsNullOrEmpty(attackerId) || string.IsNullOrEmpty(targetId))
            {
                return;
            }

            _records.Add(new AttackRecord
            {
                AttackerId = attackerId,
                TargetId = targetId,
                Weapon = weapon,
                ActorId = actorId,
                Ut = ut
            });

            Prune(ut);
        }

        public bool TryFind(string targetId, double ut, out CombatAttacker attacker)
        {
            attacker = default(CombatAttacker);
            if (string.IsNullOrEmpty(targetId))
            {
                return false;
            }

            AttackRecord best = null;
            for (int i = 0; i < _records.Count; i++)
            {
                AttackRecord record = _records[i];
                if (!string.Equals(record.TargetId, targetId, StringComparison.Ordinal))
                {
                    continue;
                }
                if (ut - record.Ut > WindowSeconds || record.Ut - ut > 1.0)
                {
                    continue;
                }
                if (best == null || record.Ut > best.Ut)
                {
                    best = record;
                }
            }

            if (best == null)
            {
                return false;
            }

            attacker = new CombatAttacker
            {
                AttackerId = best.AttackerId,
                Weapon = best.Weapon,
                ActorId = best.ActorId,
                Ut = best.Ut
            };
            return true;
        }

        public void Prune(double ut)
        {
            if (_records.Count == 0)
            {
                return;
            }

            _records.RemoveAll(record => ut - record.Ut > WindowSeconds);
            if (_records.Count > MaxRecords)
            {
                _records.RemoveRange(0, _records.Count - MaxRecords);
            }
        }

        public void Clear()
        {
            _records.Clear();
        }
    }
}
