"""SubAgent.set_egress hands the driver what the platform did with the rules
it may not give itself: those waiting for the owner, and those the owner
blocked on the sub-agent."""

import driver_sdk as d


def test_set_egress_returns_waiting_and_blocked(stub):
    outcome = {
        "waiting": [{"host": "pypi.org", "id": "req-1"}],
        "blocked": [{"host": "evil.example"}],
    }
    stub.routes[("POST", "/invocations/sub-1/egress")] = (200, outcome)
    rules = [
        {"host": "pypi.org", "verdict": "allow"},
        {"host": "evil.example", "verdict": "allow"},
    ]

    assert d.sub_agent("sub-1").set_egress(rules) == outcome
    assert stub.requests[-1] == (
        "POST",
        "/api/agents/test-driver/invocations/sub-1/egress",
        {"rules": rules},
    )
