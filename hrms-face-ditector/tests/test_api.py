"""End-to-end checks over the HTTP surface the Node backend will call."""

from __future__ import annotations

import numpy as np
import pytest

from .conftest import blank_frame

ORG = "org_test"


@pytest.fixture(scope="module")
def enrolled(client, auth, known_face):
    """Enroll one face and push it as the org's gallery. Returns its embedding."""
    response = client.post("/v1/embed", json={"image": known_face}, headers=auth)
    assert response.status_code == 200, response.text
    embedding = response.json()["faces"][0]["embedding"]

    synced = client.put(
        f"/v1/gallery/{ORG}",
        json={"version": "v1", "entries": [{"user_id": "emp_1", "embeddings": [embedding]}]},
        headers=auth,
    )
    assert synced.status_code == 200, synced.text
    assert synced.json() == {
        "org_id": ORG,
        "version": "v1",
        "users": 1,
        "vectors": 1,
        "synced_at": pytest.approx(synced.json()["synced_at"]),
    }
    return embedding


# --- health and auth ----------------------------------------------------------


def test_health_needs_no_key(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True


def test_endpoints_reject_a_missing_key(client, known_face):
    response = client.post("/v1/embed", json={"image": known_face})
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


def test_endpoints_reject_a_wrong_key(client, known_face):
    response = client.post(
        "/v1/embed", json={"image": known_face}, headers={"X-Face-Service-Key": "x" * 64}
    )
    assert response.status_code == 401


# --- /v1/embed ----------------------------------------------------------------


def test_embed_returns_a_unit_length_512d_vector(client, auth, known_face):
    body = client.post("/v1/embed", json={"image": known_face}, headers=auth).json()
    face = body["faces"][0]
    assert len(face["embedding"]) == 512
    assert np.linalg.norm(face["embedding"]) == pytest.approx(1.0, abs=1e-5)
    assert face["quality"]["passed"] is True


def test_embed_rejects_a_frame_with_several_faces(client, auth, group_photo):
    response = client.post("/v1/embed", json={"image": group_photo}, headers=auth)
    assert response.status_code == 422
    assert response.json()["code"] == "MULTIPLE_FACES"


def test_embed_rejects_a_frame_with_no_face(client, auth):
    blank = blank_frame()
    response = client.post("/v1/embed", json={"image": blank}, headers=auth)
    assert response.status_code == 422
    assert response.json()["code"] == "NO_FACE"


def test_embed_rejects_a_face_too_small_to_read(client, auth, tiny_face):
    response = client.post("/v1/embed", json={"image": tiny_face}, headers=auth)
    assert response.status_code == 422
    assert response.json()["code"] in {"NO_FACE", "LOW_QUALITY"}


def test_embed_rejects_garbage(client, auth):
    response = client.post("/v1/embed", json={"image": "not base64!!"}, headers=auth)
    assert response.status_code == 422
    assert response.json()["code"] in {"INVALID_BASE64", "UNDECODABLE_IMAGE"}


def test_embed_requires_exactly_one_image_field(client, auth, known_face):
    both = client.post(
        "/v1/embed", json={"image": known_face, "images": [known_face]}, headers=auth
    )
    assert both.status_code == 422
    assert both.json()["code"] == "VALIDATION_ERROR"
    assert client.post("/v1/embed", json={}, headers=auth).status_code == 422


# --- /v1/recognize ------------------------------------------------------------


def test_recognize_matches_the_enrolled_face(client, auth, known_face, enrolled):
    body = client.post(
        "/v1/recognize", json={"org_id": ORG, "image": known_face}, headers=auth
    ).json()
    assert body["matched"] is True
    assert body["reason"] == "MATCHED"
    assert body["best"]["user_id"] == "emp_1"
    assert body["best"]["score"] == pytest.approx(1.0, abs=1e-4)
    assert body["gallery_version"] == "v1"


def test_recognize_rejects_a_stranger(client, auth, other_face, enrolled):
    body = client.post(
        "/v1/recognize", json={"org_id": ORG, "image": other_face}, headers=auth
    ).json()
    assert body["matched"] is False
    assert body["reason"] == "BELOW_THRESHOLD"
    # A different person should not be anywhere near the threshold.
    assert body["best"]["score"] < 0.3


def test_recognize_refuses_an_ambiguous_frame(client, auth, group_photo, enrolled):
    body = client.post(
        "/v1/recognize", json={"org_id": ORG, "image": group_photo}, headers=auth
    ).json()
    assert body["matched"] is False
    assert body["reason"] in {"AMBIGUOUS_FRAME", "BELOW_THRESHOLD"}


def test_recognize_reports_no_face_without_erroring(client, auth, enrolled):
    blank = blank_frame()
    response = client.post("/v1/recognize", json={"org_id": ORG, "image": blank}, headers=auth)
    assert response.status_code == 200
    body = response.json()
    assert body["matched"] is False
    assert body["reason"] == "NO_FACE"


def test_recognize_takes_the_best_of_several_frames(client, auth, known_face, enrolled):
    blank = blank_frame()
    body = client.post(
        "/v1/recognize", json={"org_id": ORG, "images": [blank, known_face]}, headers=auth
    ).json()
    assert body["matched"] is True
    assert body["frame_index"] == 1


def test_recognize_honours_a_stricter_threshold(client, auth, other_face, enrolled):
    body = client.post(
        "/v1/recognize",
        json={"org_id": ORG, "image": other_face, "min_score": 0.99},
        headers=auth,
    ).json()
    assert body["matched"] is False
    assert body["thresholds"]["min_score"] == 0.99


def test_recognize_needs_a_synced_gallery(client, auth, known_face):
    response = client.post(
        "/v1/recognize", json={"org_id": "org_never_synced", "image": known_face}, headers=auth
    )
    assert response.status_code == 409
    assert response.json()["code"] == "GALLERY_NOT_LOADED"


def test_recognize_detects_a_stale_gallery(client, auth, known_face, enrolled):
    response = client.post(
        "/v1/recognize",
        json={"org_id": ORG, "image": known_face, "expected_version": "v-old"},
        headers=auth,
    )
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "GALLERY_STALE"
    assert body["loaded_version"] == "v1"


def test_recognize_reports_an_empty_gallery(client, auth, known_face):
    client.put(f"/v1/gallery/org_empty", json={"version": "v0", "entries": []}, headers=auth)
    body = client.post(
        "/v1/recognize", json={"org_id": "org_empty", "image": known_face}, headers=auth
    ).json()
    assert body["matched"] is False
    assert body["reason"] == "EMPTY_GALLERY"


# --- /v1/gallery --------------------------------------------------------------


def test_gallery_upsert_and_delete_round_trip(client, auth, known_face, enrolled):
    added = client.post(
        f"/v1/gallery/{ORG}/entries",
        json={"version": "v2", "user_id": "emp_2", "embeddings": [enrolled, enrolled]},
        headers=auth,
    ).json()
    assert added == {**added, "version": "v2", "users": 2, "vectors": 3}

    removed = client.delete(
        f"/v1/gallery/{ORG}/entries/emp_2", params={"version": "v3"}, headers=auth
    ).json()
    assert removed["users"] == 1
    assert removed["vectors"] == 1
    assert removed["version"] == "v3"


def test_gallery_rejects_a_wrong_sized_embedding(client, auth):
    response = client.put(
        "/v1/gallery/org_bad",
        json={"version": "v1", "entries": [{"user_id": "emp_x", "embeddings": [[0.1, 0.2]]}]},
        headers=auth,
    )
    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_EMBEDDING"


def test_gallery_upsert_requires_a_loaded_org(client, auth, enrolled):
    response = client.post(
        "/v1/gallery/org_never_synced/entries",
        json={"version": "v1", "user_id": "emp_1", "embeddings": [enrolled]},
        headers=auth,
    )
    assert response.status_code == 409
    assert response.json()["code"] == "GALLERY_NOT_LOADED"


def test_health_lists_synced_galleries(client, auth, enrolled):
    galleries = client.get("/health").json()["galleries"]
    assert any(g["org_id"] == ORG and g["users"] >= 1 for g in galleries)
