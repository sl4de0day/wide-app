use std::collections::{HashMap, HashSet, VecDeque};

use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use serde::{Deserialize, Serialize};
use wide_recon_core::similarity::{hamming_distance, normalize_document, simhash64};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateNode {
    pub id: usize,
    pub url: String,
    pub title: String,
    pub simhash: u64,
    pub status: u16,
    pub depth: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateEdge {
    pub from: usize,
    pub to: usize,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateGraphSnapshot {
    pub nodes: Vec<StateNode>,
    pub edges: Vec<StateEdge>,
    pub dot: String,
}

#[derive(Debug)]
pub struct StateGraph {
    graph: DiGraph<StateNode, String>,
    by_url: HashMap<String, NodeIndex>,
    hashes: Vec<(u64, NodeIndex)>,
    threshold: u32,
}

impl StateGraph {
    #[must_use]
    pub fn new(threshold: u32) -> Self {
        StateGraph {
            graph: DiGraph::new(),
            by_url: HashMap::new(),
            hashes: Vec::new(),
            threshold: threshold.max(1),
        }
    }

    pub fn record_transition(
        &mut self,
        from_url: Option<&str>,
        to_url: &str,
        title: &str,
        status: u16,
        depth: u32,
        body: &[u8],
        action: &str,
    ) -> usize {
        let to_idx = self.ensure_node(to_url, title, status, depth, body);
        if let Some(parent_url) = from_url {
            if let Some(&from_idx) = self.by_url.get(parent_url) {
                if from_idx != to_idx {
                    let exists = self
                        .graph
                        .edges_directed(from_idx, petgraph::Direction::Outgoing)
                        .any(|e| e.target() == to_idx && e.weight() == action);
                    if !exists {
                        self.graph.add_edge(from_idx, to_idx, action.to_string());
                    }
                }
            }
        }
        self.graph[to_idx].id
    }

    fn ensure_node(&mut self, url: &str, title: &str, status: u16, depth: u32, body: &[u8]) -> NodeIndex {
        if let Some(&idx) = self.by_url.get(url) {
            return idx;
        }
        let fp = normalize_document(body).map_or(0, |doc| simhash64(&doc.shingles));
        if fp != 0 && self.hashes.len() < 4000 {
            let new_host_path = strip_query(url);
            for &(existing_fp, existing_idx) in &self.hashes {
                if hamming_distance(fp, existing_fp) <= self.threshold {
                    if strip_query(&self.graph[existing_idx].url) == new_host_path {
                        self.by_url.insert(url.to_string(), existing_idx);
                        return existing_idx;
                    }
                }
            }
        }
        let id = self.graph.node_count();
        let node = StateNode {
            id,
            url: url.to_string(),
            title: title.to_string(),
            simhash: fp,
            status,
            depth,
        };
        let idx = self.graph.add_node(node);
        self.by_url.insert(url.to_string(), idx);
        if fp != 0 {
            self.hashes.push((fp, idx));
        }
        idx
    }

    #[must_use]
    pub fn shortest_path(&self, from_id: usize, to_id: usize) -> Option<Vec<usize>> {
        let start = NodeIndex::new(from_id);
        let goal = NodeIndex::new(to_id);
        if start.index() >= self.graph.node_count() || goal.index() >= self.graph.node_count() {
            return None;
        }
        let mut queue = VecDeque::from([start]);
        let mut visited = HashSet::from([start]);
        let mut parent: HashMap<NodeIndex, NodeIndex> = HashMap::new();
        while let Some(curr) = queue.pop_front() {
            if curr == goal {
                let mut path = vec![goal.index()];
                let mut cur = goal;
                while let Some(&prev) = parent.get(&cur) {
                    path.push(prev.index());
                    cur = prev;
                }
                path.reverse();
                return Some(path);
            }
            for next in self.graph.neighbors(curr) {
                if visited.insert(next) {
                    parent.insert(next, curr);
                    queue.push_back(next);
                }
            }
        }
        None
    }

    #[must_use]
    pub fn to_dot(&self) -> String {
        let mut out = String::from("digraph WideStateGraph {\n  rankdir=LR;\n");
        for idx in self.graph.node_indices() {
            let n = &self.graph[idx];
            let label = escape_dot(&format!("{} ({})", n.url, n.status));
            out.push_str(&format!("  n{} [label=\"{label}\"];\n", n.id));
        }
        for edge in self.graph.edge_references() {
            let label = escape_dot(edge.weight());
            out.push_str(&format!(
                "  n{} -> n{} [label=\"{label}\"];\n",
                edge.source().index(),
                edge.target().index()
            ));
        }
        out.push_str("}\n");
        out
    }

    #[must_use]
    pub fn snapshot(&self) -> StateGraphSnapshot {
        let nodes = self.graph.node_indices().map(|idx| self.graph[idx].clone()).collect();
        let edges = self
            .graph
            .edge_references()
            .map(|e| StateEdge {
                from: e.source().index(),
                to: e.target().index(),
                action: e.weight().clone(),
            })
            .collect();
        StateGraphSnapshot {
            nodes,
            edges,
            dot: self.to_dot(),
        }
    }
}

fn strip_query(url: &str) -> &str {
    url.split('?').next().unwrap_or(url)
}

fn escape_dot(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::StateGraph;

    #[test]
    fn graph_tracks_transitions_shortest_path_and_simhash_merge() {
        let mut g = StateGraph::new(8);
        let body_a = b"<main><p>Product catalog item alpha details pricing inventory status shipping warranty manual specifications reviews customer feedback portal warehouse stock dispatch tracking invoice checkout support terms privacy policy notice available online today for enterprise security teams</p></main>";
        let body_b = b"<main><p>Product catalog item beta details pricing inventory status shipping warranty manual specifications reviews customer feedback portal warehouse stock dispatch tracking invoice checkout support terms privacy policy notice available online today for enterprise security teams</p></main>";
        let s0 = g.record_transition(None, "https://app.test/", "Home", 200, 0, b"<html><body>Home login portal dashboard welcome</body></html>", "seed");
        let s1 = g.record_transition(Some("https://app.test/"), "https://app.test/items?id=1", "Items", 200, 1, body_a, "link:a");
        let s1_dup = g.record_transition(Some("https://app.test/"), "https://app.test/items?id=2", "Items", 200, 1, body_b, "link:a");
        assert_eq!(s1, s1_dup);
        let s2 = g.record_transition(Some("https://app.test/items?id=1"), "https://app.test/checkout", "Checkout", 200, 2, b"<html><body>Checkout cart payment address order confirm</body></html>", "form:post");
        assert_eq!(g.shortest_path(s0, s2), Some(vec![s0, s1, s2]));
        let snap = g.snapshot();
        assert_eq!(snap.nodes.len(), 3);
        assert!(snap.dot.contains("digraph WideStateGraph"));
    }
}
